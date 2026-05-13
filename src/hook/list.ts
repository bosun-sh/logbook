import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"

const MAX_HOOK_CONFIG_FILES = 200
const MAX_HOOK_CONFIG_BYTES = 65_536
const MAX_HOOK_COMMAND_ARGV = 64
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_STDOUT_BYTES = 1048576
const DEFAULT_STDERR_BYTES = 1048576
const HOOK_EVENTS = new Set([
  "task.status_changed",
  "task.comment_added",
  "sync.completed",
  "sync.conflict_created",
])
const textEncoder = new TextEncoder()

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]
type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

export type HookEvent =
  | "task.status_changed"
  | "task.comment_added"
  | "sync.completed"
  | "sync.conflict_created"

export type HookConfig = {
  readonly id: string
  readonly enabled: boolean
  readonly event: HookEvent
  readonly condition?:
    | {
        readonly status?: string | undefined
        readonly provider?: "linear" | undefined
        readonly project?: string | undefined
        readonly milestone?: string | undefined
      }
    | undefined
  readonly timeoutMs?: number | undefined
  readonly command: readonly string[]
  readonly cwd?: string | undefined
  readonly env?: Record<string, string> | undefined
}

export type HookInfo = {
  readonly id: string
  readonly event: string
  readonly command: string
  readonly enabled: boolean
  readonly timeoutMs: number
}

export type ListHooksInput = {
  readonly event?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}

export type HookRuntimeConfig = {
  readonly enabled: boolean
  readonly directory: ".logbook/hooks"
  readonly defaultTimeoutMs: number
  readonly stdoutBytes: number
  readonly stderrBytes: number
}

export type LoadedHook =
  | {
      readonly ok: true
      readonly fileName: string
      readonly config: HookConfig
    }
  | {
      readonly ok: false
      readonly fileName: string
      readonly id?: string | undefined
      readonly error: ToolError
    }

export type LoadedHooks = {
  readonly workspacePath: string
  readonly hooksRoot: string
  readonly runtimeConfig: HookRuntimeConfig
  readonly entries: readonly LoadedHook[]
  readonly warnings: readonly ToolWarning[]
  readonly truncated: boolean
}

type WorkspaceConfig = {
  readonly schemaVersion: "2"
  readonly hooks?:
    | {
        readonly enabled?: unknown
        readonly directory?: unknown
        readonly defaultTimeoutMs?: unknown
        readonly stdoutBytes?: unknown
        readonly stderrBytes?: unknown
      }
    | undefined
}

type Cursor = {
  readonly kind: "hook.list"
  readonly lastId: string
  readonly lastSort: readonly [string, string]
}

export const listHooks = async (
  input: ListHooksInput = {}
): Promise<
  ToolResult<{
    readonly items: HookInfo[]
    readonly hasMore: boolean
    readonly nextCursor?: string | undefined
  }>
> => {
  const loaded = await loadHooks()
  if (input.event !== undefined && !HOOK_EVENTS.has(input.event)) {
    return {
      ok: false,
      error: validationError("Hook event is not supported.", { event: input.event }),
    }
  }

  const cursorResult =
    input.cursor === undefined
      ? { ok: true as const, cursor: undefined }
      : decodeCursor(input.cursor)
  if (!cursorResult.ok) {
    return { ok: false, error: cursorResult.error }
  }

  const limit = normalizeLimit(input.limit)
  const items = loaded.entries
    .filter((entry): entry is Extract<LoadedHook, { ok: true }> => entry.ok)
    .map((entry) => toHookInfo(entry.config, loaded.runtimeConfig))
    .filter((item) => input.event === undefined || item.event === input.event)
    .sort(compareHookInfo)
    .filter((item) =>
      cursorResult.cursor === undefined
        ? true
        : compareHookSort(sortTuple(item), cursorResult.cursor.lastSort) > 0
    )

  const page = items.slice(0, limit)
  const hasMore = loaded.truncated || items.length > limit
  const lastPageItem = page.at(-1)
  const nextCursor = lastPageItem !== undefined && hasMore ? encodeCursor(lastPageItem) : undefined
  const warnings = [...loaded.warnings]
  if (items.length > limit) {
    warnings.push({
      code: "has_more",
      message: "Additional hook records are available through a cursor.",
      ...(nextCursor === undefined ? {} : { details: { cursor: nextCursor } }),
    })
  }

  return {
    ok: true,
    data: {
      items: page,
      hasMore,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
    ...(warnings.length === 0 ? {} : { warnings }),
  }
}

export const loadHooks = async (workspacePath = process.cwd()): Promise<LoadedHooks> => {
  const root = resolve(workspacePath)
  const runtimeConfig = await readRuntimeConfig(root)
  const hooksRoot = join(root, runtimeConfig.directory)
  const warnings: ToolWarning[] = []
  const entries = await readdir(hooksRoot, { withFileTypes: true }).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return []
    }
    throw cause
  })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const scanned = files.slice(0, MAX_HOOK_CONFIG_FILES)
  const truncated = files.length > MAX_HOOK_CONFIG_FILES
  if (truncated) {
    warnings.push({
      code: "has_more",
      message: "Additional hook config files were not scanned.",
      details: {
        path: ".logbook/hooks/",
        hasMore: true,
        scanned: MAX_HOOK_CONFIG_FILES,
        total: files.length,
      },
    })
  }

  const loaded: LoadedHook[] = []
  for (const fileName of scanned) {
    loaded.push(await readHookConfig(root, hooksRoot, fileName))
  }

  for (const entry of loaded) {
    if (!entry.ok) {
      warnings.push({
        code: "hook_config_invalid",
        message: entry.error.message,
        details: {
          path: `.logbook/hooks/${basename(entry.fileName)}`,
          ...(entry.id === undefined ? {} : { hookId: entry.id }),
          ...(entry.error.details === undefined ? {} : entry.error.details),
        },
      })
    }
  }

  return {
    workspacePath: root,
    hooksRoot,
    runtimeConfig,
    entries: loaded,
    warnings,
    truncated,
  }
}

export const toHookInfo = (config: HookConfig, runtimeConfig: HookRuntimeConfig): HookInfo => ({
  id: config.id,
  event: config.event,
  command: config.command.join(" "),
  enabled: config.enabled,
  timeoutMs: config.timeoutMs ?? runtimeConfig.defaultTimeoutMs,
})

export const isPathInside = (parent: string, candidate: string): boolean => {
  const resolvedParent = resolve(parent)
  const resolvedCandidate = resolve(candidate)
  return (
    resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${sep}`)
  )
}

export const validationError = (message: string, details?: Record<string, unknown>): ToolError => ({
  code: "validation_error",
  message,
  ...(details === undefined ? {} : { details }),
})

const readRuntimeConfig = async (workspacePath: string): Promise<HookRuntimeConfig> => {
  const configPath = join(workspacePath, ".logbook/config.json")
  const entry = await stat(configPath).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (entry === null || !entry.isFile() || entry.size > MAX_HOOK_CONFIG_BYTES) {
    return defaultRuntimeConfig()
  }

  try {
    const value = JSON.parse(await readFile(configPath, "utf8")) as unknown
    if (!isRecord(value) || value.schemaVersion !== "2") {
      return defaultRuntimeConfig()
    }
    return parseRuntimeConfig(value as WorkspaceConfig)
  } catch {
    return defaultRuntimeConfig()
  }
}

const parseRuntimeConfig = (config: WorkspaceConfig): HookRuntimeConfig => {
  const hooks = isRecord(config.hooks) ? config.hooks : {}
  return {
    enabled: typeof hooks.enabled === "boolean" ? hooks.enabled : true,
    directory: hooks.directory === ".logbook/hooks" ? ".logbook/hooks" : ".logbook/hooks",
    defaultTimeoutMs: positiveIntegerOrDefault(hooks.defaultTimeoutMs, DEFAULT_TIMEOUT_MS),
    stdoutBytes: positiveIntegerOrDefault(hooks.stdoutBytes, DEFAULT_STDOUT_BYTES),
    stderrBytes: positiveIntegerOrDefault(hooks.stderrBytes, DEFAULT_STDERR_BYTES),
  }
}

const defaultRuntimeConfig = (): HookRuntimeConfig => ({
  enabled: true,
  directory: ".logbook/hooks",
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  stdoutBytes: DEFAULT_STDOUT_BYTES,
  stderrBytes: DEFAULT_STDERR_BYTES,
})

const readHookConfig = async (
  workspacePath: string,
  hooksRoot: string,
  fileName: string
): Promise<LoadedHook> => {
  const path = join(hooksRoot, fileName)
  try {
    const entry = await stat(path)
    if (!entry.isFile() || entry.size > MAX_HOOK_CONFIG_BYTES) {
      return invalidHook(fileName, undefined, "Hook config file is not a bounded JSON file.")
    }
    const content = await readFile(path, "utf8")
    if (byteLength(content) > MAX_HOOK_CONFIG_BYTES) {
      return invalidHook(fileName, undefined, "Hook config file is not a bounded JSON file.")
    }
    const parsed = JSON.parse(content) as unknown
    const result = parseHookConfig(parsed, workspacePath)
    return result.ok
      ? { ok: true, fileName, config: result.config }
      : { ok: false, fileName, id: extractHookId(parsed), error: result.error }
  } catch (cause) {
    return invalidHook(fileName, undefined, "Hook config could not be read.", {
      cause: String(cause),
    })
  }
}

const parseHookConfig = (
  value: unknown,
  workspacePath: string
):
  | { readonly ok: true; readonly config: HookConfig }
  | { readonly ok: false; readonly error: ToolError } => {
  if (!isRecord(value)) {
    return { ok: false, error: validationError("Hook config must be a JSON object.") }
  }
  const allowed = new Set([
    "id",
    "enabled",
    "event",
    "condition",
    "timeoutMs",
    "command",
    "cwd",
    "env",
  ])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        error: validationError("Hook config contains unknown fields.", { field: key }),
      }
    }
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return { ok: false, error: validationError("Hook config id must be a non-empty string.") }
  }
  if (typeof value.enabled !== "boolean") {
    return {
      ok: false,
      error: validationError("Hook config enabled must be a boolean.", { hookId: value.id }),
    }
  }
  if (typeof value.event !== "string" || !HOOK_EVENTS.has(value.event)) {
    return {
      ok: false,
      error: validationError("Hook event is not supported.", { hookId: value.id }),
    }
  }
  if (typeof value.command === "string") {
    return {
      ok: false,
      error: validationError("Hook command must be an argv array, not a shell string.", {
        hookId: value.id,
      }),
    }
  }
  if (
    !Array.isArray(value.command) ||
    value.command.length === 0 ||
    !value.command.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    return {
      ok: false,
      error: validationError("Hook command must be a non-empty argv string array.", {
        hookId: value.id,
      }),
    }
  }
  if (value.command.length > MAX_HOOK_COMMAND_ARGV) {
    return {
      ok: false,
      error: validationError(`Hook command argv exceeds ${MAX_HOOK_COMMAND_ARGV} entries.`, {
        hookId: value.id,
        actual: value.command.length,
        max: MAX_HOOK_COMMAND_ARGV,
      }),
    }
  }
  if (value.timeoutMs !== undefined && !isPositiveInteger(value.timeoutMs)) {
    return {
      ok: false,
      error: validationError("Hook timeoutMs must be a positive integer.", { hookId: value.id }),
    }
  }
  if (value.cwd !== undefined) {
    if (typeof value.cwd !== "string" || value.cwd.length === 0) {
      return {
        ok: false,
        error: validationError("Hook cwd must be a non-empty string.", { hookId: value.id }),
      }
    }
    if (!isPathInside(workspacePath, resolve(workspacePath, value.cwd))) {
      return {
        ok: false,
        error: validationError("Hook cwd must resolve inside the workspace.", { hookId: value.id }),
      }
    }
  }
  if (
    value.env !== undefined &&
    (!isRecord(value.env) || !Object.values(value.env).every((entry) => typeof entry === "string"))
  ) {
    return {
      ok: false,
      error: validationError("Hook env must be a string record.", { hookId: value.id }),
    }
  }
  if (value.condition !== undefined && !isHookCondition(value.condition)) {
    return {
      ok: false,
      error: validationError("Hook condition is not compatible with v2.", { hookId: value.id }),
    }
  }

  return {
    ok: true,
    config: {
      id: value.id,
      enabled: value.enabled,
      event: value.event as HookEvent,
      command: Object.freeze([...value.command]),
      ...(value.condition === undefined ? {} : { condition: value.condition }),
      ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
      ...(value.env === undefined ? {} : { env: value.env as Record<string, string> }),
    },
  }
}

const isHookCondition = (value: unknown): value is NonNullable<HookConfig["condition"]> => {
  if (!isRecord(value)) {
    return false
  }
  const allowed = new Set(["status", "provider", "project", "milestone"])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return false
    }
  }
  return (
    (value.status === undefined || typeof value.status === "string") &&
    (value.provider === undefined || value.provider === "linear") &&
    (value.project === undefined || typeof value.project === "string") &&
    (value.milestone === undefined || typeof value.milestone === "string")
  )
}

const invalidHook = (
  fileName: string,
  id: string | undefined,
  message: string,
  details?: Record<string, unknown>
): LoadedHook => ({
  ok: false,
  fileName,
  id,
  error: validationError(message, details),
})

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isInteger(limit) || limit < 1
    ? DEFAULT_LIMIT
    : Math.min(limit, MAX_LIMIT)

const encodeCursor = (item: HookInfo): string =>
  Buffer.from(
    JSON.stringify({
      kind: "hook.list",
      lastId: item.id,
      lastSort: sortTuple(item),
    } satisfies Cursor)
  ).toString("base64url")

const decodeCursor = (
  cursor: string
):
  | { readonly ok: true; readonly cursor: Cursor }
  | { readonly ok: false; readonly error: ToolError } => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown
    if (
      isRecord(parsed) &&
      parsed.kind === "hook.list" &&
      typeof parsed.lastId === "string" &&
      Array.isArray(parsed.lastSort) &&
      parsed.lastSort.length === 2 &&
      parsed.lastSort.every((entry) => typeof entry === "string")
    ) {
      return { ok: true, cursor: parsed as unknown as Cursor }
    }
  } catch {
    // fall through
  }
  return { ok: false, error: validationError("Invalid hook.list cursor.") }
}

const compareHookInfo = (left: HookInfo, right: HookInfo): number =>
  compareHookSort(sortTuple(left), sortTuple(right))

const compareHookSort = (
  left: readonly [string, string],
  right: readonly [string, string]
): number =>
  left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0])

const sortTuple = (item: HookInfo): readonly [string, string] => [item.event, item.id]

const extractHookId = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.id === "string" ? value.id : undefined

const positiveIntegerOrDefault = (value: unknown, fallback: number): number =>
  isPositiveInteger(value) ? value : fallback

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === "number" && value > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnoent = (error: unknown): boolean =>
  isRecord(error) && "code" in error && error.code === "ENOENT"

const byteLength = (value: string): number => textEncoder.encode(value).length
