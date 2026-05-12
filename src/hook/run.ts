import { spawn } from "node:child_process"
import { resolve } from "node:path"
import type { Readable } from "node:stream"
import type { ToolResult } from "@logbook/shared/result.js"
import {
  type HookConfig,
  type HookEvent,
  type HookRuntimeConfig,
  isPathInside,
  loadHooks,
  validationError,
} from "./list.js"

const textDecoder = new TextDecoder()

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]

export type RunHookInput = {
  readonly hookId: string
  readonly event: string
  readonly dryRun?: boolean | undefined
}

export type HookRunResult = {
  readonly hookId: string
  readonly event: HookEvent
  readonly startedAt: string
  readonly finishedAt: string
  readonly exitCode?: number | undefined
  readonly timedOut: boolean
  readonly stdout?: string | undefined
  readonly stderr?: string | undefined
  readonly warnings?: ToolWarning[] | undefined
}

type CapturedStream = {
  readonly text: string
  readonly truncated: boolean
}

export const runHook = async (input: RunHookInput): Promise<ToolResult<HookRunResult>> => {
  if (typeof input.hookId !== "string" || input.hookId.length === 0) {
    return { ok: false, error: validationError("hookId must be a non-empty string.") }
  }

  const loaded = await loadHooks()
  const matchingInvalid = loaded.entries.find((entry) => !entry.ok && entry.id === input.hookId)
  if (matchingInvalid !== undefined && !matchingInvalid.ok) {
    return { ok: false, error: matchingInvalid.error }
  }

  const matching = loaded.entries.find(
    (entry): entry is Extract<(typeof loaded.entries)[number], { ok: true }> =>
      entry.ok && entry.config.id === input.hookId
  )
  if (matching === undefined) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "Hook was not found.",
        details: { hookId: input.hookId },
      },
    }
  }

  const hook = matching.config
  if (hook.event !== input.event) {
    return {
      ok: false,
      error: validationError("Hook event does not match the target hook.", {
        hookId: input.hookId,
        expected: hook.event,
        actual: input.event,
      }),
    }
  }
  if (!hook.enabled) {
    return {
      ok: false,
      error: validationError("Hook is disabled.", { hookId: input.hookId }),
    }
  }
  const mutationError = rejectCanonicalStorageMutation(hook)
  if (mutationError !== null) {
    return { ok: false, error: mutationError }
  }

  const startedAt = new Date().toISOString()
  if (input.dryRun === true) {
    return {
      ok: true,
      data: {
        hookId: hook.id,
        event: hook.event,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        timedOut: false,
        warnings: [
          {
            code: "hook_dry_run",
            message: "Hook command was validated but not executed.",
          },
        ],
      },
    }
  }

  const result = await executeHook(hook, loaded.workspacePath, loaded.runtimeConfig, startedAt)
  return { ok: true, data: result }
}

const executeHook = async (
  hook: HookConfig,
  workspacePath: string,
  runtimeConfig: HookRuntimeConfig,
  startedAt: string
): Promise<HookRunResult> => {
  const cwd = resolve(workspacePath, hook.cwd ?? ".")
  const timeoutMs = hook.timeoutMs ?? runtimeConfig.defaultTimeoutMs
  const [command, ...args] = hook.command
  const subprocess = spawn(command ?? "", args, {
    cwd,
    env: { ...process.env, ...(hook.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = captureStream(subprocess.stdout, runtimeConfig.stdoutBytes)
  const stderr = captureStream(subprocess.stderr, runtimeConfig.stderrBytes)
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let spawnFailed = false
  const exitedPromise = new Promise<number>((resolveExit) => {
    subprocess.once("error", () => {
      spawnFailed = true
      resolveExit(1)
    })
    subprocess.once("close", (code) => {
      resolveExit(code ?? 0)
    })
  })
  const timeoutPromise = new Promise<undefined>((resolveTimeout) => {
    timeout = setTimeout(() => {
      timedOut = true
      subprocess.kill()
      resolveTimeout(undefined)
    }, timeoutMs)
  })

  const exited = await Promise.race([exitedPromise, timeoutPromise])
  if (timeout !== undefined) {
    clearTimeout(timeout)
  }

  const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr])
  const warnings: ToolWarning[] = []
  if (timedOut) {
    warnings.push({
      code: "hook_timeout",
      message: `Hook command exceeded ${timeoutMs} ms and was terminated.`,
      details: { timeoutMs },
    })
  }
  if (capturedStdout.truncated) {
    warnings.push(outputWarning("stdout", runtimeConfig.stdoutBytes))
  }
  if (capturedStderr.truncated) {
    warnings.push(outputWarning("stderr", runtimeConfig.stderrBytes))
  }

  return {
    hookId: hook.id,
    event: hook.event,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(timedOut ? {} : { exitCode: typeof exited === "number" ? exited : spawnFailed ? 1 : 0 }),
    timedOut,
    ...(capturedStdout.text.length === 0 ? {} : { stdout: capturedStdout.text }),
    ...(capturedStderr.text.length === 0 ? {} : { stderr: capturedStderr.text }),
    ...(warnings.length === 0 ? {} : { warnings }),
  }
}

const captureStream = async (
  stream: Readable | null,
  maxBytes: number
): Promise<CapturedStream> => {
  if (stream === null) {
    return { text: "", truncated: false }
  }
  const chunks: Uint8Array[] = []
  let captured = 0
  let truncated = false

  for await (const chunk of stream) {
    const value =
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    if (captured >= maxBytes) {
      truncated = true
      continue
    }
    const remaining = maxBytes - captured
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining))
      captured += remaining
      truncated = true
    } else {
      chunks.push(value)
      captured += value.byteLength
    }
  }

  const combined = new Uint8Array(captured)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: textDecoder.decode(combined), truncated }
}

const outputWarning = (stream: "stdout" | "stderr", maxBytes: number): ToolWarning => ({
  code: "hook_output_truncated",
  message: `Hook ${stream} exceeded ${maxBytes} bytes and was truncated.`,
  details: { stream, maxBytes },
})

const rejectCanonicalStorageMutation = (
  hook: HookConfig
): ReturnType<typeof validationError> | null => {
  for (const entry of hook.command) {
    if (entry.includes(".logbook/storage")) {
      return validationError("Hook command must not target canonical storage paths directly.", {
        hookId: hook.id,
      })
    }
  }

  const executable = hook.command[0]
  if (executable !== undefined && isPathInside(resolve(".logbook/storage"), executable)) {
    return validationError("Hook command must not execute canonical storage paths directly.", {
      hookId: hook.id,
    })
  }
  return null
}
