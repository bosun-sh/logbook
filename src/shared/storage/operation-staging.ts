import { AsyncLocalStorage } from "node:async_hooks"
import { readFile } from "node:fs/promises"

export type StagedFile = { before: string | null; after: string }
export const operationStaging = new AsyncLocalStorage<Map<string, StagedFile>>()

export const readCanonicalFile = async (path: string): Promise<string> => {
  const staged = operationStaging.getStore()?.get(path)
  return staged ? staged.after : readFile(path, "utf8")
}

export const stageCanonicalWrite = async (path: string, after: string): Promise<boolean> => {
  const files = operationStaging.getStore()
  if (!files) return false
  const existing = files.get(path)
  const before = existing ? existing.before : await readOptionalFile(path)
  files.set(path, { before, after })
  return true
}

export const readOptionalFile = (path: string): Promise<string | null> =>
  readFile(path, "utf8").catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null
    throw cause
  })
