import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import type { ToolResult } from "@logbook/shared/result.js"
import { type SetupLinearSyncInput, setupLinearSync } from "@logbook/sync/linear/setup.js"
import { type LinearGraphQLClient, LinearTransport } from "@logbook/sync/linear/transport.js"
import {
  initWorkspace,
  type WorkspaceInitInput,
  type WorkspaceInitResult,
} from "@logbook/workspace/init.js"
import { Context, Effect, Layer } from "effect"

type Write = (chunk: string) => void
type ReadLine = {
  readonly question: (query: string) => Promise<string>
  readonly close: () => void
}

export type InitOnboardingOptions = {
  readonly stdin?: NodeJS.ReadableStream | undefined
  readonly stdout?: Write | undefined
  readonly stderr?: Write | undefined
}

type ParsedInitArgs = {
  readonly workspace: WorkspaceInitInput
  readonly yes: boolean
  readonly skipMcp: boolean
  readonly mcpClient?: McpClient | undefined
  readonly noLinear: boolean
  readonly linearTeamUrl?: string | undefined
  readonly linearApiToken?: string | undefined
  readonly writeEnv: boolean
}

type McpClient = "claude" | "opencode" | "none"

type McpWriteResult = {
  readonly client: Exclude<McpClient, "none">
  readonly path: string
  readonly created: boolean
}

const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

export const runInitOnboarding = async (
  argv: readonly string[],
  options: InitOnboardingOptions = {}
): Promise<number> => {
  const stdout = options.stdout ?? ((chunk: string) => process.stdout.write(chunk))
  const stderr = options.stderr ?? ((chunk: string) => process.stderr.write(chunk))
  const parsed = parseInitArgs(argv)
  if (!parsed.ok) {
    stderr(`error: ${parsed.error}\n`)
    return 1
  }

  const workspaceRoot = resolve(parsed.value.workspace.path ?? process.cwd())
  stdout(`Initializing Logbook workspace at ${workspaceRoot}\n`)
  const workspace = await Effect.runPromise(
    initWorkspace(parsed.value.workspace) as Effect.Effect<
      ToolResult<WorkspaceInitResult>,
      never,
      never
    >
  )
  if (!workspace.ok) {
    writeToolFailure(stderr, workspace)
    return 1
  }
  stdout(`Workspace ready (${workspace.data.createdPaths.length} paths created).\n`)

  const readline =
    parsed.value.yes || hasAllPromptAnswers(parsed.value)
      ? undefined
      : createInterface({
          input: options.stdin ?? process.stdin,
          output: process.stdout,
        })

  try {
    const mcpClient = await chooseMcpClient(parsed.value, workspaceRoot, readline)
    if (mcpClient === "none") {
      stdout("MCP setup skipped.\n")
    } else {
      const mcp = await writeMcpConfig(workspaceRoot, mcpClient)
      stdout(`MCP configured for ${formatMcpClient(mcp.client)} at ${mcp.path}.\n`)
    }

    const linearInput = await chooseLinearInput(parsed.value, readline)
    if (linearInput === undefined) {
      stdout("Linear setup skipped.\n")
    } else {
      const linear = await runInWorkspace(workspaceRoot, () =>
        Effect.runPromise(
          Effect.provide(
            setupLinearSync(linearInput),
            Layer.succeed(LinearGraphQLClientTag, makeLinearClient(linearInput))
          )
        )
      )
      if (!linear.ok) {
        writeToolFailure(stderr, linear)
        return 1
      }
      stdout(`Linear sync configured for team ${linear.data.defaultTeamId}.\n`)
    }
  } finally {
    readline?.close()
  }

  stdout("Logbook is ready. Configure agents to run: logbook mcp\n")
  return 0
}

const parseInitArgs = (
  argv: readonly string[]
):
  | { readonly ok: true; readonly value: ParsedInitArgs }
  | { readonly ok: false; readonly error: string } => {
  const flags: Record<string, unknown> = {}
  let index = 0
  while (index < argv.length) {
    const arg = argv[index]
    if (arg === undefined) {
      index += 1
      continue
    }
    if (!arg.startsWith("--")) {
      return { ok: false, error: `unexpected positional argument: ${arg}` }
    }

    const withoutPrefix = arg.slice(2)
    const equalsIndex = withoutPrefix.indexOf("=")
    if (equalsIndex >= 0) {
      flags[normalizeFlagName(withoutPrefix.slice(0, equalsIndex))] = parseFlagValue(
        withoutPrefix.slice(equalsIndex + 1)
      )
      index += 1
      continue
    }

    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      flags[normalizeFlagName(withoutPrefix)] = true
      index += 1
      continue
    }

    flags[normalizeFlagName(withoutPrefix)] = parseFlagValue(next)
    index += 2
  }

  const mcpClient = parseMcpClient(flags.mcpClient)
  if (!mcpClient.ok) {
    return mcpClient
  }

  return {
    ok: true,
    value: {
      workspace: {
        ...(typeof flags.path === "string" ? { path: flags.path } : {}),
        ...(typeof flags.force === "boolean" ? { force: flags.force } : {}),
        ...(typeof flags.migrateV1 === "boolean" ? { migrateV1: flags.migrateV1 } : {}),
      },
      yes: flags.yes === true,
      skipMcp: flags.skipMcp === true,
      ...(mcpClient.value === undefined ? {} : { mcpClient: mcpClient.value }),
      noLinear: flags.noLinear === true,
      ...(typeof flags.linearTeamUrl === "string" ? { linearTeamUrl: flags.linearTeamUrl } : {}),
      ...(typeof flags.linearApiToken === "string" ? { linearApiToken: flags.linearApiToken } : {}),
      writeEnv: flags.writeEnv === true,
    },
  }
}

const normalizeFlagName = (key: string): string =>
  key.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const parseFlagValue = (value: string): unknown => {
  const trimmed = value.trim()
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  return value
}

const parseMcpClient = (
  value: unknown
):
  | { readonly ok: true; readonly value?: McpClient | undefined }
  | { readonly ok: false; readonly error: string } => {
  if (value === undefined) {
    return { ok: true }
  }
  if (value === "claude" || value === "opencode" || value === "none") {
    return { ok: true, value }
  }
  return { ok: false, error: "--mcp-client must be claude, opencode, or none" }
}

const chooseMcpClient = async (
  args: ParsedInitArgs,
  workspaceRoot: string,
  readline: ReadLine | undefined
): Promise<McpClient> => {
  if (args.skipMcp) return "none"
  if (args.mcpClient !== undefined) return args.mcpClient

  const detected = await detectMcpClients(workspaceRoot)
  if (args.yes) {
    return detected[0] ?? "claude"
  }
  if (readline === undefined) {
    return "none"
  }

  const defaultClient = detected[0] ?? "claude"
  const answer = (
    await readline.question(`Configure MCP client? [${defaultClient}/opencode/none] `)
  )
    .trim()
    .toLowerCase()
  if (answer.length === 0) return defaultClient
  if (answer === "claude" || answer === "opencode" || answer === "none") return answer
  return "none"
}

const detectMcpClients = async (
  workspaceRoot: string
): Promise<readonly Exclude<McpClient, "none">[]> => {
  const detected: Exclude<McpClient, "none">[] = []
  if (await exists(resolve(workspaceRoot, ".claude/settings.json"))) detected.push("claude")
  if (await exists(resolve(workspaceRoot, "opencode.json"))) detected.push("opencode")
  return detected
}

const writeMcpConfig = async (
  workspaceRoot: string,
  client: Exclude<McpClient, "none">
): Promise<McpWriteResult> => {
  if (client === "claude") {
    const path = resolve(workspaceRoot, ".claude/settings.json")
    const existing = await readJsonObject(path)
    const next = {
      ...existing.value,
      mcpServers: {
        ...(isRecord(existing.value.mcpServers) ? existing.value.mcpServers : {}),
        logbook: { command: "logbook", args: ["mcp"] },
      },
    }
    await writeJsonObject(path, next)
    return { client, path, created: !existing.exists }
  }

  const path = resolve(workspaceRoot, "opencode.json")
  const existing = await readJsonObject(path)
  const next = {
    ...existing.value,
    mcp: {
      ...(isRecord(existing.value.mcp) ? existing.value.mcp : {}),
      logbook: { type: "local", command: ["logbook", "mcp"], enabled: true },
    },
  }
  await writeJsonObject(path, next)
  return { client, path, created: !existing.exists }
}

const chooseLinearInput = async (
  args: ParsedInitArgs,
  readline: ReadLine | undefined
): Promise<SetupLinearSyncInput | undefined> => {
  if (args.noLinear) return undefined
  if (args.linearTeamUrl !== undefined) {
    return {
      teamUrl: args.linearTeamUrl,
      ...(args.linearApiToken === undefined ? {} : { apiToken: args.linearApiToken }),
      writeEnv: args.writeEnv,
    }
  }
  if (args.yes || readline === undefined) return undefined

  const wantsLinear = (await readline.question("Set up Linear sync now? [y/N] "))
    .trim()
    .toLowerCase()
  if (wantsLinear !== "y" && wantsLinear !== "yes") return undefined

  const teamUrl = (await readline.question("Linear team URL: ")).trim()
  if (teamUrl.length === 0) return undefined

  const apiToken = (await readline.question("Linear API token (blank to use environment): ")).trim()
  return {
    teamUrl,
    ...(apiToken.length === 0 ? {} : { apiToken }),
    writeEnv: apiToken.length > 0,
  }
}

const makeLinearClient = (input: SetupLinearSyncInput): LinearGraphQLClient => ({
  request: <TData extends Record<string, unknown>>(
    request: Parameters<LinearGraphQLClient["request"]>[0]
  ) =>
    Effect.gen(function* () {
      const apiToken =
        typeof input.apiToken === "string" && input.apiToken.trim().length > 0
          ? input.apiToken.trim()
          : (process.env[input.apiTokenEnv ?? "LINEAR_API_KEY"] ?? "")
      return yield* LinearTransport.make({ apiToken }).request<TData>(request)
    }),
})

const hasAllPromptAnswers = (args: ParsedInitArgs): boolean => {
  const hasMcpAnswer = args.skipMcp || args.mcpClient !== undefined
  const hasLinearAnswer = args.noLinear || args.linearTeamUrl !== undefined
  return hasMcpAnswer && hasLinearAnswer
}

const readJsonObject = async (
  path: string
): Promise<{ readonly exists: boolean; readonly value: Record<string, unknown> }> => {
  const content = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isEnoent(cause)) return undefined
    throw cause
  })
  if (content === undefined) return { exists: false, value: {} }
  const parsed = JSON.parse(content) as unknown
  return { exists: true, value: isRecord(parsed) ? parsed : {} }
}

const writeJsonObject = async (path: string, value: Record<string, unknown>): Promise<void> => {
  await mkdir(resolve(path, ".."), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const exists = async (path: string): Promise<boolean> =>
  (await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) return null
    throw cause
  })) !== null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnoent = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT"

const formatMcpClient = (client: Exclude<McpClient, "none">): string =>
  client === "claude" ? "Claude Code" : "OpenCode"

const writeToolFailure = (
  stderr: Write,
  result: Extract<ToolResult<never>, { ok: false }>
): void => {
  stderr(`error: ${result.error.message}\n`)
}

const runInWorkspace = async <T>(workspaceRoot: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.cwd()
  process.chdir(workspaceRoot)
  try {
    return await run()
  } finally {
    process.chdir(previous)
  }
}
