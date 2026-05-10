import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { migrateV1Workspace, type V1WorkspaceMigrationResult } from "./migrate-v1.js"
import { resolveWorkspacePaths } from "./storage-layout.js"
import { StoragePaths } from "./storage-paths.js"

const LOGBOOK_VERSION = "2.0.0"
const MAX_CONFIG_JSON_BYTES = 65_536
const textEncoder = new TextEncoder()

export type WorkspaceInitInput = {
  readonly path?: string | undefined
  readonly force?: boolean | undefined
  readonly migrateV1?: boolean | undefined
}

export type WorkspaceInitResult = {
  readonly workspace: {
    readonly path: string
    readonly schemaVersion: 2
  }
  readonly createdPaths: string[]
  readonly migrated?: boolean | undefined
  readonly warnings?: NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]> | undefined
}

type WorkspaceConfig = {
  readonly schemaVersion: "2"
  readonly workspaceName?: string | undefined
  readonly defaultProject?: string | undefined
  readonly defaultMilestone?: string | undefined
  readonly storage: { readonly root: ".logbook/storage" }
  readonly hooks: {
    readonly enabled: boolean
    readonly directory: ".logbook/hooks"
    readonly defaultTimeoutMs: number
    readonly stdoutBytes: number
    readonly stderrBytes: number
  }
  readonly linear?: unknown
}

type WorkspaceMetadata = {
  readonly schemaVersion: "2"
  readonly workspaceId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly logbookVersion: string
  readonly storageRoot: ".logbook/storage"
}

type WorkspaceInitState = {
  readonly now: string
  readonly force: boolean
  readonly createdPaths: string[]
}

type WorkspaceError = {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

const defaultConfig: WorkspaceConfig = {
  schemaVersion: "2",
  storage: { root: ".logbook/storage" },
  hooks: {
    enabled: true,
    directory: ".logbook/hooks",
    defaultTimeoutMs: 5000,
    stdoutBytes: 1048576,
    stderrBytes: 1048576,
  },
}

export const initWorkspace = (
  input: WorkspaceInitInput = {}
): Effect.Effect<ToolResult<WorkspaceInitResult>, never, Clock.Clock> =>
  Effect.gen(function* () {
    const now = yield* nowIso()
    return yield* Effect.promise(() => initWorkspaceUnsafe(input, now))
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.succeed({
        ok: false as const,
        error: workspaceError("Failed to initialize workspace.", { cause: String(cause) }),
      })
    )
  )

const initWorkspaceUnsafe = async (
  input: WorkspaceInitInput,
  now: string
): Promise<ToolResult<WorkspaceInitResult>> => {
  const workspacePath = resolve(input.path ?? process.cwd())
  const layout = resolveWorkspacePaths(workspacePath)
  const state: WorkspaceInitState = {
    now,
    force: input.force ?? false,
    createdPaths: [],
  }

  try {
    await ensureDirectory(layout.logbookRoot, StoragePaths.root, state)
    await ensureDirectory(layout.storageRoot, StoragePaths.storageRoot, state)
    await ensureDirectory(layout.hooksRoot, StoragePaths.hooksRoot, state)
    await ensureConfig(layout.config, state)
    await ensureMetadata(layout.metadata, state)
    await materializeHookTemplates(layout.hooksRoot, state)

    for (const [path, relativePath] of [
      [layout.epics, StoragePaths.epics],
      [layout.stories, StoragePaths.stories],
      [layout.tasks, StoragePaths.tasks],
      [layout.contextEntries, StoragePaths.contextEntries],
      [layout.externalLinks, StoragePaths.externalLinks],
      [layout.syncEvents, StoragePaths.syncEvents],
      [layout.syncConflicts, StoragePaths.syncConflicts],
    ] as const) {
      await ensureJsonlFile(path, relativePath, state)
    }

    const migration =
      input.migrateV1 === false
        ? ({ ok: true, data: { migrated: false, taskCount: 0 } } as const)
        : await Effect.runPromise(
            migrateV1Workspace({ path: workspacePath, now }) as Effect.Effect<
              ToolResult<V1WorkspaceMigrationResult>,
              never,
              never
            >
          )
    if (!migration.ok) {
      return migration
    }

    return {
      ok: true,
      data: {
        workspace: {
          path: workspacePath,
          schemaVersion: 2,
        },
        createdPaths: state.createdPaths,
        ...(migration.data.migrated ? { migrated: true } : {}),
      },
      ...(migration.warnings === undefined ? {} : { warnings: migration.warnings }),
    }
  } catch (cause) {
    return {
      ok: false,
      error: normalizeWorkspaceError(cause),
    }
  }
}

const HOOK_TEMPLATES_DIR = join(dirname(new URL(import.meta.url).pathname), "hook-templates")
const HOOK_TEMPLATE_IDS = ["review-spawn", "need-info-notify"] as const
const HOOK_TEMPLATE_FILES = ["config.json", "script.ts"] as const

const materializeHookTemplates = async (
  hooksRoot: string,
  state: WorkspaceInitState
): Promise<void> => {
  for (const hookId of HOOK_TEMPLATE_IDS) {
    const hookDir = join(hooksRoot, hookId)
    await mkdir(hookDir, { recursive: true })
    for (const fileName of HOOK_TEMPLATE_FILES) {
      const dest = join(hookDir, fileName)
      const existing = await stat(dest).catch((cause: unknown) => {
        if (isEnoent(cause)) return null
        throw cause
      })
      if (existing !== null) {
        continue
      }
      const templatePath = join(HOOK_TEMPLATES_DIR, hookId, fileName)
      const content = await readFile(templatePath, "utf8").catch((cause: unknown) => {
        throw workspaceError(`Failed to read hook template: ${hookId}/${fileName}.`, {
          templatePath,
          cause: String(cause),
        })
      })
      await writeFile(dest, content, "utf8")
      state.createdPaths.push(`.logbook/hooks/${hookId}/${fileName}`)
    }
  }
}

const ensureDirectory = async (
  path: string,
  relativePath: string,
  state: WorkspaceInitState
): Promise<void> => {
  const existing = await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (existing !== null) {
    if (!existing.isDirectory()) {
      throw workspaceError("Workspace path is incompatible with the v2 layout.", {
        path: relativePath,
        expected: "directory",
      })
    }
    return
  }

  await mkdir(path, { recursive: true })
  state.createdPaths.push(withDirectorySlash(relativePath))
}

const ensureConfig = async (path: string, state: WorkspaceInitState): Promise<void> => {
  const existing = await readBoundedJsonFile(path, StoragePaths.config)
  if (existing.exists) {
    validateWorkspaceConfig(existing.value)
    return
  }

  await writeJson(path, defaultConfig)
  state.createdPaths.push(StoragePaths.config)
}

const ensureMetadata = async (
  path: string,
  state: WorkspaceInitState
): Promise<WorkspaceMetadata> => {
  const existing = await readBoundedJsonFile(path, StoragePaths.metadata)
  if (existing.exists) {
    const parsed = parseWorkspaceMetadata(existing.value)
    if (parsed !== null) {
      return parsed
    }

    if (!state.force) {
      throw workspaceError("Workspace metadata is not compatible with v2.", {
        path: StoragePaths.metadata,
      })
    }
  }

  const metadata: WorkspaceMetadata = {
    schemaVersion: "2",
    workspaceId: createId("workspace"),
    createdAt: state.now,
    updatedAt: state.now,
    logbookVersion: LOGBOOK_VERSION,
    storageRoot: ".logbook/storage",
  }
  await writeJson(path, metadata)
  if (!state.createdPaths.includes(StoragePaths.metadata)) {
    state.createdPaths.push(StoragePaths.metadata)
  }
  return metadata
}

const ensureJsonlFile = async (
  path: string,
  relativePath: string,
  state: WorkspaceInitState
): Promise<void> => {
  const existing = await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (existing !== null) {
    if (!existing.isFile()) {
      throw workspaceError("Workspace storage path is incompatible with the v2 layout.", {
        path: relativePath,
        expected: "jsonl_file",
      })
    }
    return
  }

  await writeFile(path, "", "utf8")
  state.createdPaths.push(relativePath)
}

const readBoundedJsonFile = async (
  path: string,
  relativePath: string
): Promise<{ readonly exists: false } | { readonly exists: true; readonly value: unknown }> => {
  const existing = await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (existing === null) {
    return { exists: false }
  }
  if (!existing.isFile()) {
    throw workspaceError("Workspace JSON path is incompatible with the v2 layout.", {
      path: relativePath,
      expected: "json_file",
    })
  }
  if (existing.size > MAX_CONFIG_JSON_BYTES) {
    throw workspaceError(`Workspace config JSON exceeds ${MAX_CONFIG_JSON_BYTES} bytes.`, {
      path: relativePath,
      actualBytes: existing.size,
      maxBytes: MAX_CONFIG_JSON_BYTES,
    })
  }

  const content = await readFile(path, "utf8")
  if (byteLength(content) > MAX_CONFIG_JSON_BYTES) {
    throw workspaceError(`Workspace config JSON exceeds ${MAX_CONFIG_JSON_BYTES} bytes.`, {
      path: relativePath,
      actualBytes: byteLength(content),
      maxBytes: MAX_CONFIG_JSON_BYTES,
    })
  }

  try {
    return { exists: true, value: JSON.parse(content) }
  } catch {
    throw workspaceError("Workspace JSON file is not valid JSON.", {
      path: relativePath,
    })
  }
}

const validateWorkspaceConfig = (value: unknown): void => {
  if (!isRecord(value) || value.schemaVersion !== "2") {
    throw workspaceError("Workspace config is not compatible with v2.", {
      path: StoragePaths.config,
    })
  }
  if (!isRecord(value.storage) || value.storage.root !== ".logbook/storage") {
    throw workspaceError("Workspace config storage root is not canonical.", {
      path: StoragePaths.config,
    })
  }
  if (
    !isRecord(value.hooks) ||
    typeof value.hooks.enabled !== "boolean" ||
    value.hooks.directory !== ".logbook/hooks" ||
    typeof value.hooks.defaultTimeoutMs !== "number" ||
    typeof value.hooks.stdoutBytes !== "number" ||
    typeof value.hooks.stderrBytes !== "number"
  ) {
    throw workspaceError("Workspace config hooks settings are not compatible with v2.", {
      path: StoragePaths.config,
    })
  }
}

const parseWorkspaceMetadata = (value: unknown): WorkspaceMetadata | null => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "2" ||
    typeof value.workspaceId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.logbookVersion !== "string" ||
    value.storageRoot !== ".logbook/storage"
  ) {
    return null
  }

  return {
    schemaVersion: "2",
    workspaceId: value.workspaceId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    logbookVersion: value.logbookVersion,
    storageRoot: ".logbook/storage",
  }
}

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

const withDirectorySlash = (path: string): string => (path.endsWith("/") ? path : `${path}/`)

const byteLength = (value: string): number => textEncoder.encode(value).length

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnoent = (error: unknown): boolean =>
  isRecord(error) && "code" in error && error.code === "ENOENT"

const workspaceError = (message: string, details?: Record<string, unknown>): WorkspaceError => ({
  code: "workspace_error",
  message,
  ...(details === undefined ? {} : { details }),
})

const normalizeWorkspaceError = (cause: unknown): WorkspaceError => {
  if (isRecord(cause) && typeof cause.code === "string" && typeof cause.message === "string") {
    return {
      code: cause.code,
      message: cause.message,
      ...(isRecord(cause.details) ? { details: cause.details } : {}),
    }
  }

  return workspaceError("Failed to initialize workspace.", { cause: String(cause) })
}
