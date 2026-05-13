import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import type { Task } from "@logbook/task/schema.js"
import { Effect } from "effect"
import { TaskRepository } from "./repositories.js"
import { resolveWorkspacePaths, StoragePaths } from "./storage-layout.js"

const MAX_CONFIG_JSON_BYTES = 65_536
const MAX_HOOK_CONFIG_FILES = 200
const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "need_info",
  "blocked",
  "pending_review",
  "done",
  "canceled",
] as const
const textEncoder = new TextEncoder()

export type WorkspaceStatusInput = {
  readonly path?: string | undefined
  readonly checkProvider?: false | undefined
}

type TaskStatus = (typeof TASK_STATUSES)[number]
type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]

export type LinearStatus = {
  readonly configured: boolean
  readonly reachable?: boolean | undefined
  readonly authenticated?: boolean | undefined
  readonly lastSyncAt?: string | undefined
  readonly pendingConflicts: number
  readonly warnings?: ToolWarning[] | undefined
}

export type WorkspaceStatus = {
  readonly path: string
  readonly initialized: boolean
  readonly schemaVersion?: 2 | undefined
  readonly tasks: {
    readonly total: number
    readonly byStatus: Record<TaskStatus, number>
  }
  readonly storage: {
    readonly canonicalFilesPresent: boolean
    readonly duckdbIndexPresent: boolean
  }
  readonly hooks: {
    readonly configured: number
    readonly enabled: number
  }
  readonly providers: {
    readonly linear?: LinearStatus | undefined
  }
}

export type WorkspaceStatusResult = {
  readonly status: WorkspaceStatus
  readonly warnings?: ToolWarning[] | undefined
}

type WorkspaceConfig = {
  readonly schemaVersion: "2"
  readonly hooks?: {
    readonly directory?: unknown
  }
  readonly linear?:
    | {
        readonly apiTokenEnv?: unknown
      }
    | undefined
}

type WorkspaceError = Extract<ToolResult<never>, { ok: false }>["error"]

export const getWorkspaceStatus = (
  input: WorkspaceStatusInput = {}
): Effect.Effect<ToolResult<WorkspaceStatusResult>, never> =>
  Effect.tryPromise({
    try: () => getWorkspaceStatusUnsafe(input),
    catch: normalizeWorkspaceError,
  }).pipe(Effect.catchAll((error) => Effect.succeed({ ok: false as const, error })))

const getWorkspaceStatusUnsafe = async (
  input: WorkspaceStatusInput
): Promise<ToolResult<WorkspaceStatusResult>> => {
  const workspacePath = resolve(input.path ?? process.cwd())
  const layout = resolveWorkspacePaths(workspacePath)
  const warnings: ToolWarning[] = []

  const configResult = await readWorkspaceConfig(layout.config)
  if (!configResult.ok) {
    return { ok: false, error: configResult.error }
  }

  const metadataResult = await readWorkspaceMetadata(layout.metadata)
  if (!metadataResult.ok) {
    return { ok: false, error: metadataResult.error }
  }

  const missingCanonicalPaths = await findMissingCanonicalPaths(workspacePath)
  if (missingCanonicalPaths.length > 0) {
    return {
      ok: false,
      error: storageError("Canonical workspace storage is incomplete.", {
        missingPaths: missingCanonicalPaths,
      }),
    }
  }

  const tasksResult = await readTaskStatusCounts(workspacePath)
  if (!tasksResult.ok) {
    return { ok: false, error: tasksResult.error }
  }

  const hooks = await readHookStatus(workspacePath, configResult.value, warnings)
  const linear = await readLinearStatus(configResult.value, warnings)

  const status: WorkspaceStatus = {
    path: workspacePath,
    initialized: true,
    schemaVersion: metadataResult.schemaVersion,
    tasks: tasksResult.value,
    storage: {
      canonicalFilesPresent: true,
      duckdbIndexPresent: await hasDuckDbIndex(workspacePath),
    },
    hooks,
    providers: {
      ...(linear === undefined ? {} : { linear }),
    },
  }

  return {
    ok: true,
    data: {
      status,
      ...(warnings.length === 0 ? {} : { warnings }),
    },
  }
}

const readWorkspaceConfig = async (
  path: string
): Promise<
  | { readonly ok: true; readonly value: WorkspaceConfig }
  | { readonly ok: false; readonly error: WorkspaceError }
> => {
  const json = await readBoundedJson(path, StoragePaths.config)
  if (!json.ok) {
    return json
  }
  if (!isRecord(json.value) || json.value.schemaVersion !== "2") {
    return {
      ok: false,
      error: workspaceError("Workspace config is not compatible with v2.", {
        path: StoragePaths.config,
      }),
    }
  }

  return { ok: true, value: json.value as WorkspaceConfig }
}

const readWorkspaceMetadata = async (
  path: string
): Promise<
  | { readonly ok: true; readonly schemaVersion: 2 }
  | { readonly ok: false; readonly error: WorkspaceError }
> => {
  const json = await readBoundedJson(path, StoragePaths.metadata)
  if (!json.ok) {
    return json
  }
  if (!isRecord(json.value) || json.value.schemaVersion !== "2") {
    return {
      ok: false,
      error: workspaceError("Workspace metadata is not compatible with v2.", {
        path: StoragePaths.metadata,
      }),
    }
  }

  return { ok: true, schemaVersion: 2 }
}

const readBoundedJson = async (
  path: string,
  relativePath: string
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: WorkspaceError }
> => {
  const entry = await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (entry === null) {
    return {
      ok: false,
      error: workspaceError("Workspace JSON file is missing.", { path: relativePath }),
    }
  }
  if (!entry.isFile()) {
    return {
      ok: false,
      error: workspaceError("Workspace JSON path is incompatible with the v2 layout.", {
        path: relativePath,
        expected: "json_file",
      }),
    }
  }
  if (entry.size > MAX_CONFIG_JSON_BYTES) {
    return oversizedConfigError(relativePath, entry.size)
  }

  const content = await readFile(path, "utf8")
  const actualBytes = byteLength(content)
  if (actualBytes > MAX_CONFIG_JSON_BYTES) {
    return oversizedConfigError(relativePath, actualBytes)
  }

  try {
    return { ok: true, value: JSON.parse(content) }
  } catch {
    return {
      ok: false,
      error: workspaceError("Workspace JSON file is not valid JSON.", { path: relativePath }),
    }
  }
}

const oversizedConfigError = (
  path: string,
  actualBytes: number
): { readonly ok: false; readonly error: WorkspaceError } => ({
  ok: false,
  error: workspaceError(`Workspace config JSON exceeds ${MAX_CONFIG_JSON_BYTES} bytes.`, {
    path,
    actualBytes,
    maxBytes: MAX_CONFIG_JSON_BYTES,
  }),
})

const findMissingCanonicalPaths = async (workspacePath: string): Promise<string[]> => {
  const layout = resolveWorkspacePaths(workspacePath)
  const canonicalFiles = [
    [layout.epics, StoragePaths.epics],
    [layout.stories, StoragePaths.stories],
    [layout.tasks, StoragePaths.tasks],
    [layout.contextEntries, StoragePaths.contextEntries],
    [layout.externalLinks, StoragePaths.externalLinks],
    [layout.syncEvents, StoragePaths.syncEvents],
    [layout.syncConflicts, StoragePaths.syncConflicts],
  ] as const
  const missing: string[] = []

  for (const [absolutePath, relativePath] of canonicalFiles) {
    const entry = await stat(absolutePath).catch((cause: unknown) => {
      if (isEnoent(cause)) {
        return null
      }
      throw cause
    })
    if (entry === null || !entry.isFile()) {
      missing.push(relativePath)
    }
  }

  return missing
}

const readTaskStatusCounts = async (
  workspacePath: string
): Promise<
  | { readonly ok: true; readonly value: WorkspaceStatus["tasks"] }
  | { readonly ok: false; readonly error: WorkspaceError }
> => {
  const repository = new TaskRepository({ workspaceRoot: workspacePath })
  const result = await Effect.runPromiseExit(repository.list())
  if (result._tag === "Failure") {
    return {
      ok: false,
      error: storageError("Failed to read canonical task storage.", {
        cause: String(result.cause),
      }),
    }
  }

  return { ok: true, value: countTasksByStatus(result.value) }
}

const countTasksByStatus = (tasks: readonly Task[]): WorkspaceStatus["tasks"] => {
  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >
  for (const task of tasks) {
    byStatus[task.status] += 1
  }

  return {
    total: tasks.length,
    byStatus,
  }
}

const readHookStatus = async (
  workspacePath: string,
  config: WorkspaceConfig,
  warnings: ToolWarning[]
): Promise<WorkspaceStatus["hooks"]> => {
  const configuredDirectory =
    isRecord(config.hooks) && config.hooks.directory === ".logbook/hooks"
      ? ".logbook/hooks"
      : StoragePaths.hooksRoot
  const hooksRoot = join(workspacePath, configuredDirectory)
  const entries = await readdir(hooksRoot, { withFileTypes: true }).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      warnings.push({
        code: "missing_optional_integration",
        message: "Hook directory is not present.",
        details: { path: StoragePaths.hooksRoot },
      })
      return []
    }
    throw cause
  })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const scanned = files.slice(0, MAX_HOOK_CONFIG_FILES)
  if (files.length > MAX_HOOK_CONFIG_FILES) {
    warnings.push({
      code: "has_more",
      message: "Additional hook config files were not scanned.",
      details: {
        path: StoragePaths.hooksRoot,
        hasMore: true,
        scanned: MAX_HOOK_CONFIG_FILES,
        total: files.length,
      },
    })
  }

  let configured = 0
  let enabled = 0
  for (const fileName of scanned) {
    const hookPath = join(hooksRoot, fileName)
    const content = await readFile(hookPath, "utf8").catch((cause: unknown) => {
      warnings.push(invalidHookWarning(fileName, `Failed to read hook config: ${String(cause)}`))
      return null
    })
    if (content === null) {
      continue
    }

    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      warnings.push(invalidHookWarning(fileName, "Hook config is not valid JSON."))
      continue
    }
    if (!isHookConfig(value)) {
      warnings.push(invalidHookWarning(fileName, "Hook config is not compatible with v2."))
      continue
    }

    configured += 1
    if (value.enabled) {
      enabled += 1
    }
  }

  return { configured, enabled }
}

const readLinearStatus = async (
  config: WorkspaceConfig,
  warnings: ToolWarning[]
): Promise<LinearStatus | undefined> => {
  if (!isRecord(config.linear)) {
    return undefined
  }

  const apiTokenEnv =
    typeof config.linear.apiTokenEnv === "string" && config.linear.apiTokenEnv.length > 0
      ? config.linear.apiTokenEnv
      : "LINEAR_API_KEY"
  const authenticated =
    typeof process.env[apiTokenEnv] === "string" && (process.env[apiTokenEnv]?.length ?? 0) > 0
  const providerWarnings: ToolWarning[] = []
  if (!authenticated) {
    const warning = {
      code: "provider_warning",
      message: "Linear is configured but its API token environment variable is not set.",
      details: {
        provider: "linear",
        apiTokenEnv,
      },
    } satisfies ToolWarning
    providerWarnings.push(warning)
    warnings.push(warning)
  }

  return {
    configured: true,
    authenticated,
    pendingConflicts: 0,
    ...(providerWarnings.length === 0 ? {} : { warnings: providerWarnings }),
  }
}

const hasDuckDbIndex = async (workspacePath: string): Promise<boolean> => {
  const candidates = [
    ".logbook/storage/logbook.duckdb",
    ".logbook/storage/index.duckdb",
    ".logbook/logbook.duckdb",
    ".logbook/index.duckdb",
  ]

  for (const relativePath of candidates) {
    const entry = await stat(join(workspacePath, relativePath)).catch((cause: unknown) => {
      if (isEnoent(cause)) {
        return null
      }
      throw cause
    })
    if (entry?.isFile()) {
      return true
    }
  }

  return false
}

const isHookConfig = (value: unknown): value is { readonly enabled: boolean } =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.enabled === "boolean" &&
  typeof value.event === "string" &&
  Array.isArray(value.command) &&
  value.command.every((entry) => typeof entry === "string")

const invalidHookWarning = (fileName: string, message: string): ToolWarning => ({
  code: "hook_warning",
  message,
  details: {
    path: `${StoragePaths.hooksRoot}${basename(fileName)}`,
  },
})

const normalizeWorkspaceError = (cause: unknown): WorkspaceError => {
  if (isRecord(cause) && typeof cause.code === "string" && typeof cause.message === "string") {
    return {
      code: cause.code,
      message: cause.message,
      ...(isRecord(cause.details) ? { details: cause.details } : {}),
    }
  }

  return workspaceError("Failed to read workspace status.", { cause: String(cause) })
}

const workspaceError = (message: string, details?: Record<string, unknown>): WorkspaceError => ({
  code: "workspace_error",
  message,
  ...(details === undefined ? {} : { details }),
})

const storageError = (message: string, details?: Record<string, unknown>): WorkspaceError => ({
  code: "storage_error",
  message,
  ...(details === undefined ? {} : { details }),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnoent = (error: unknown): boolean =>
  isRecord(error) && "code" in error && error.code === "ENOENT"

const byteLength = (value: string): number => textEncoder.encode(value).length
