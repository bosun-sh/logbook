// ohtools bundles its own copy of effect; brand identity drift is bridged via local casts.
import type { OhtoolsError, RunResult, RuntimeOptions } from "@bosun-sh/ohtools"
import { toToolResult } from "@logbook/plugin/results.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Effect } from "effect"
import { cliCommands } from "./cli-commands.js"
import { createLogbookApp } from "./ohtools-app.js"
import { translateV1CliCommand } from "./v1-cli-aliases.js"

const DEFAULT_MAX_STDIN_JSON_BYTES = 1_048_576
const DEFAULT_MAX_ARGS = 200
const DEFAULT_MAX_RESULT_JSON_BYTES = 4_194_304
const textEncoder = new TextEncoder()

type Write = (chunk: string) => void

type CliError = {
  readonly code: "cli_parse_error" | "adapter_error"
  readonly message: string
  readonly details?: Record<string, unknown>
}

type RunCliOptions = {
  readonly stdin?: string | undefined
  readonly stdout?: Write | undefined
  readonly stderr?: Write | undefined
  readonly layer?: RuntimeOptions["layer"] | undefined
  readonly maxStdinJsonBytes?: number | undefined
  readonly maxArgs?: number | undefined
  readonly maxResultJsonBytes?: number | undefined
}

type ParsedCommand = {
  readonly alias: string
  readonly toolId: string
  readonly input: Record<string, unknown>
  readonly warnings: readonly NonNullable<
    Extract<ToolResult<never>, { ok: true }>["warnings"]
  >[number][]
  readonly withCompatibilityOutput?: (<T>(envelope: ToolResult<T>) => ToolResult<T>) | undefined
}

type ParseResult =
  | { readonly ok: true; readonly command: ParsedCommand }
  | { readonly ok: false; readonly error: CliError }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const cliError = (
  code: CliError["code"],
  message: string,
  details?: Record<string, unknown>
): CliError => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
})

export const runCli = async (
  argv: readonly string[],
  options: RunCliOptions = {}
): Promise<number> => {
  const stdout = options.stdout ?? ((chunk: string) => process.stdout.write(chunk))
  const parseResult = parseCli(argv, options)
  if (!parseResult.ok) {
    writeEnvelope(stdout, { ok: false, error: parseResult.error }, options)
    return 1
  }

  const app = createLogbookApp()
  const runtimeOptions: RuntimeOptions = options.layer === undefined ? {} : { layer: options.layer }
  const runtime = app.runtime(runtimeOptions)
  const runResult = await Effect.runPromiseExit(
    runtime.run({
      toolId: parseResult.command.toolId,
      input: parseResult.command.input,
    }) as unknown as Effect.Effect<RunResult<unknown>, OhtoolsError, never>
  )

  if (runResult._tag === "Failure") {
    const envelope: ToolResult<never> = {
      ok: false,
      error: cliError("adapter_error", "CLI adapter failed to run the tool."),
    }
    writeEnvelope(stdout, envelope, options)
    return 1
  }

  const rawEnvelope = toToolResult(runResult.value.output, runResult.value.warnings)
  const envelope = parseResult.command.withCompatibilityOutput?.(rawEnvelope) ?? rawEnvelope
  const bounded = enforceResultBound(envelope, options)
  writeEnvelope(stdout, bounded, options)
  return bounded.ok ? 0 : 1
}

const parseCli = (argv: readonly string[], options: RunCliOptions): ParseResult => {
  const maxArgs = options.maxArgs ?? DEFAULT_MAX_ARGS
  if (argv.length > maxArgs) {
    return {
      ok: false,
      error: cliError("cli_parse_error", `CLI arguments exceed ${maxArgs}.`, {
        actualCount: argv.length,
        maxArgs,
      }),
    }
  }

  const [alias, ...args] = argv
  if (alias === undefined || alias.length === 0) {
    return {
      ok: false,
      error: cliError("cli_parse_error", "Missing CLI command."),
    }
  }

  const command = cliCommands.find((candidate) => candidate.alias === alias)
  if (command === undefined) {
    return {
      ok: false,
      error: cliError("cli_parse_error", `Unknown CLI command: ${alias}.`),
    }
  }

  if (!command.toolId.includes(".")) {
    return {
      ok: false,
      error: cliError("cli_parse_error", `CLI command is not backed by a v2 tool: ${alias}.`),
    }
  }

  const stdinInput = parseStdinJson(options.stdin ?? "", options)
  if (!stdinInput.ok) {
    return stdinInput
  }

  const argsInput = parseFlagArgs(args)
  if (!argsInput.ok) {
    return argsInput
  }

  const input = {
    ...stdinInput.value,
    ...argsInput.value,
  }
  const translation =
    "compatibility" in command && command.compatibility === "v1"
      ? translateV1CliCommand(command.alias, input)
      : null

  return {
    ok: true,
    command: {
      alias: command.alias,
      toolId: translation?.toolId ?? command.toolId,
      input: translation?.input ?? input,
      warnings: translation?.warnings ?? [],
      withCompatibilityOutput: translation?.withCompatibilityOutput,
    },
  }
}

const parseStdinJson = (
  stdin: string,
  options: RunCliOptions
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: CliError } => {
  if (stdin.length === 0 || stdin.trim().length === 0) {
    return { ok: true, value: {} }
  }

  const maxBytes = options.maxStdinJsonBytes ?? DEFAULT_MAX_STDIN_JSON_BYTES
  const actualBytes = textEncoder.encode(stdin).length
  if (actualBytes > maxBytes) {
    return {
      ok: false,
      error: cliError("cli_parse_error", `CLI stdin JSON exceeds ${maxBytes} bytes.`, {
        actualBytes,
        maxBytes,
      }),
    }
  }

  try {
    const parsed = JSON.parse(stdin)
    if (!isRecord(parsed)) {
      return {
        ok: false,
        error: cliError("cli_parse_error", "CLI input must be a JSON object."),
      }
    }

    return { ok: true, value: parsed }
  } catch {
    return {
      ok: false,
      error: cliError("cli_parse_error", "CLI stdin must contain valid JSON."),
    }
  }
}

const parseFlagArgs = (
  args: readonly string[]
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: CliError } => {
  const input: Record<string, unknown> = {}
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === undefined) {
      index += 1
      continue
    }

    if (!arg.startsWith("--")) {
      return {
        ok: false,
        error: cliError("cli_parse_error", `Unexpected positional argument: ${arg}.`),
      }
    }

    const withoutPrefix = arg.slice(2)
    if (withoutPrefix.length === 0) {
      return {
        ok: false,
        error: cliError("cli_parse_error", "Empty CLI option is not allowed."),
      }
    }

    const equalsIndex = withoutPrefix.indexOf("=")
    if (equalsIndex >= 0) {
      const key = withoutPrefix.slice(0, equalsIndex)
      const value = withoutPrefix.slice(equalsIndex + 1)
      input[normalizeFlagName(key)] = parseFlagValue(value)
      index += 1
      continue
    }

    const next = args[index + 1]
    if (next === undefined || next.startsWith("--")) {
      input[normalizeFlagName(withoutPrefix)] = true
      index += 1
      continue
    }

    input[normalizeFlagName(withoutPrefix)] = parseFlagValue(next)
    index += 2
  }

  return { ok: true, value: input }
}

const normalizeFlagName = (key: string): string =>
  key.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const parseFlagValue = (value: string): unknown => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

const enforceResultBound = <T>(envelope: ToolResult<T>, options: RunCliOptions): ToolResult<T> => {
  const maxBytes = options.maxResultJsonBytes ?? DEFAULT_MAX_RESULT_JSON_BYTES
  const bytes = textEncoder.encode(JSON.stringify(envelope)).length
  if (bytes <= maxBytes) {
    return envelope
  }

  return {
    ok: false,
    error: cliError("adapter_error", `Tool result JSON exceeds ${maxBytes} bytes.`, {
      maxBytes,
    }),
  }
}

const writeEnvelope = (
  stdout: Write,
  envelope: ToolResult<unknown>,
  options: RunCliOptions
): void => {
  const bounded = enforceResultBound(envelope, options)
  stdout(`${JSON.stringify(bounded)}\n`)
}

export type { RunCliOptions }
