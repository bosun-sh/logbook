import { join } from "node:path"

export { StoragePaths } from "./storage-paths.js"

import { StoragePaths } from "./storage-paths.js"

const MAX_PATH_BYTES = 4096

interface ResolvedStorageLayout {
  readonly workspaceRoot: string
  readonly logbookRoot: string
  readonly config: string
  readonly metadata: string
  readonly storageRoot: string
  readonly hooksRoot: string
  readonly epics: string
  readonly stories: string
  readonly tasks: string
  readonly contextEntries: string
  readonly externalLinks: string
  readonly syncEvents: string
  readonly syncConflicts: string
}

export const resolveWorkspacePaths = (workspaceRoot: string): ResolvedStorageLayout => {
  validateWorkspaceRoot(workspaceRoot)
  return buildStorageLayout(workspaceRoot)
}

export const ensureStorageLayout = (layout: ResolvedStorageLayout): ResolvedStorageLayout => {
  validateWorkspaceRoot(layout.workspaceRoot)
  validateResolvedLayout(layout)
  return layout
}

const buildStorageLayout = (workspaceRoot: string): ResolvedStorageLayout => ({
  workspaceRoot,
  logbookRoot: join(workspaceRoot, StoragePaths.root),
  config: join(workspaceRoot, StoragePaths.config),
  metadata: join(workspaceRoot, StoragePaths.metadata),
  storageRoot: join(workspaceRoot, StoragePaths.storageRoot),
  hooksRoot: join(workspaceRoot, StoragePaths.hooksRoot),
  epics: join(workspaceRoot, StoragePaths.epics),
  stories: join(workspaceRoot, StoragePaths.stories),
  tasks: join(workspaceRoot, StoragePaths.tasks),
  contextEntries: join(workspaceRoot, StoragePaths.contextEntries),
  externalLinks: join(workspaceRoot, StoragePaths.externalLinks),
  syncEvents: join(workspaceRoot, StoragePaths.syncEvents),
  syncConflicts: join(workspaceRoot, StoragePaths.syncConflicts),
})

const validateResolvedLayout = (layout: ResolvedStorageLayout): void => {
  const expected = buildStorageLayout(layout.workspaceRoot)
  for (const key of Object.keys(expected) as Array<keyof ResolvedStorageLayout>) {
    validatePathBytes(layout[key], key)
    if (layout[key] !== expected[key]) {
      throw validationError(`non-canonical storage path for ${String(key)}`, layout[key])
    }
  }
}

const validateWorkspaceRoot = (workspaceRoot: string): void => {
  validatePathBytes(workspaceRoot, "workspaceRoot")
  if (workspaceRoot.length === 0) {
    throw validationError("workspaceRoot must be a non-empty string", workspaceRoot)
  }
}

const validatePathBytes = (path: string, label: string): void => {
  if (byteLength(path) > MAX_PATH_BYTES) {
    throw validationError(`${label} exceeds ${MAX_PATH_BYTES} bytes`, path)
  }
}

const byteLength = (value: string): number => new TextEncoder().encode(value).length

const validationError = (message: string, path: string) => ({
  _tag: "validation_error" as const,
  message,
  path,
})
