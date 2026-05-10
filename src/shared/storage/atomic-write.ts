import { mkdir, open, rename as renameFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Effect } from "effect"
import { withCanonicalWriteLock } from "./transaction.js"

const DEFAULT_MAX_TEMP_SUFFIX_ATTEMPTS = 10

type AtomicWriteIo = {
  readonly writeFile?: typeof writeFile
  readonly rename?: typeof renameFile
  readonly open?: typeof open
}

export type AtomicWriteJsonlOptions = {
  readonly filePath: string
  readonly lines: readonly string[]
  readonly validateLine: (parsed: unknown, line: number) => void
  readonly maxTempSuffixAttempts?: number
  readonly io?: AtomicWriteIo
}

export type AtomicWriteError = {
  readonly _tag: "storage_error"
  readonly message: string
  readonly filePath: string
  readonly operation: "write"
  readonly cause?: unknown
}

export const atomicWriteJsonl = (
  options: AtomicWriteJsonlOptions
): Effect.Effect<void, AtomicWriteError> =>
  withCanonicalWriteLock(
    options.filePath,
    Effect.tryPromise({
      try: async () => {
        const write = options.io?.writeFile ?? writeFile
        const rename = options.io?.rename ?? renameFile
        const openFile = options.io?.open ?? open
        const maxAttempts = options.maxTempSuffixAttempts ?? DEFAULT_MAX_TEMP_SUFFIX_ATTEMPTS
        const content = options.lines.length === 0 ? "" : `${options.lines.join("\n")}\n`

        validateLines(options)
        await mkdir(dirname(options.filePath), { recursive: true })

        let lastError: unknown
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const tempPath = `${options.filePath}.tmp-${process.pid}-${Date.now()}-${attempt}`
          try {
            await write(tempPath, content, "utf8")
            const handle = await openFile(tempPath, "r")
            try {
              await handle.sync()
            } finally {
              await handle.close()
            }
            await rename(tempPath, options.filePath)
            return
          } catch (error) {
            lastError = error
          }
        }

        throw storageError(
          options.filePath,
          "Atomic rewrite temp suffix attempts exhausted",
          lastError
        )
      },
      catch: (error) =>
        isStorageError(error)
          ? error
          : storageError(options.filePath, `Failed to write ${options.filePath}`, error),
    })
  )

const validateLines = (options: AtomicWriteJsonlOptions): void => {
  for (const [index, line] of options.lines.entries()) {
    if (line.trim().length === 0) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw storageError(options.filePath, `Invalid JSON at output line ${index + 1}`, error)
    }

    try {
      options.validateLine(parsed, index + 1)
    } catch (error) {
      throw storageError(options.filePath, `Validation failed at output line ${index + 1}`, error)
    }
  }
}

const storageError = (filePath: string, message: string, cause?: unknown): AtomicWriteError => ({
  _tag: "storage_error",
  message,
  filePath,
  operation: "write",
  cause,
})

const isStorageError = (error: unknown): error is AtomicWriteError =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "storage_error"

export { withCanonicalWriteLock }
