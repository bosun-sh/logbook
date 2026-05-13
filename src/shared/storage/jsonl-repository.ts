import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Clock, Effect } from "effect"
import type { ZodType } from "zod"

const DEFAULT_MAX_SCAN_LINES = 100_000
const DEFAULT_MAX_LINE_BYTES = 1_048_576
const DEFAULT_MAX_VALIDATION_ERRORS = 50
const MAX_TEMP_SUFFIX_ATTEMPTS = 10
const textEncoder = new TextEncoder()

type JsonlEntity = {
  readonly id: string
  readonly kind: string
  readonly updatedAt: string
  readonly deletedAt?: string | undefined
}

type ValidationDetail = {
  readonly filePath: string
  readonly line: number
  readonly entityKind?: string | undefined
  readonly issues: readonly string[]
}

export type JsonlRepositoryError =
  | {
      readonly _tag: "not_found"
      readonly message: string
      readonly filePath: string
      readonly id: string
    }
  | {
      readonly _tag: "conflict"
      readonly message: string
      readonly filePath: string
      readonly id: string
      readonly line: number
      readonly conflictingLine: number
    }
  | {
      readonly _tag: "malformed_record"
      readonly message: string
      readonly filePath: string
      readonly line: number
      readonly reason: "invalid_json" | "line_too_long"
    }
  | {
      readonly _tag: "validation_error"
      readonly message: string
      readonly filePath: string
      readonly details: readonly ValidationDetail[]
      readonly truncated: boolean
    }
  | {
      readonly _tag: "storage_error"
      readonly message: string
      readonly filePath: string
      readonly operation: "read" | "write"
      readonly cause?: unknown
    }

type ParsedRecord<T extends JsonlEntity> = {
  readonly entity: T
  readonly line: number
}

type RepositoryState<T extends JsonlEntity> = {
  readonly records: readonly ParsedRecord<T>[]
  readonly activeRecords: readonly ParsedRecord<T>[]
}

export type JsonlRepositoryOptions<T extends JsonlEntity> = {
  readonly entityName: string
  readonly filePath: string
  readonly schema: ZodType<T>
  readonly initialized?: boolean | undefined
  readonly maxScanLines?: number | undefined
  readonly maxLineBytes?: number | undefined
  readonly maxValidationErrors?: number | undefined
}

export class JsonlRepository<T extends JsonlEntity> {
  private readonly entityName: string
  private readonly filePath: string
  private readonly schema: ZodType<T>
  private readonly initialized: boolean
  private readonly maxScanLines: number
  private readonly maxLineBytes: number
  private readonly maxValidationErrors: number

  constructor(options: JsonlRepositoryOptions<T>) {
    this.entityName = options.entityName
    this.filePath = options.filePath
    this.schema = options.schema
    this.initialized = options.initialized ?? false
    this.maxScanLines = options.maxScanLines ?? DEFAULT_MAX_SCAN_LINES
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
    this.maxValidationErrors = options.maxValidationErrors ?? DEFAULT_MAX_VALIDATION_ERRORS
  }

  create(entity: T): Effect.Effect<T, JsonlRepositoryError> {
    return Effect.tryPromise({
      try: async () => {
        const state = await this.readState()
        const existing = state.activeRecords.find((record) => record.entity.id === entity.id)
        if (existing) {
          throw this.conflictError(entity.id, existing.line, existing.line)
        }

        const nextLines = state.records.map((record) => this.serialize(record.entity))
        nextLines.push(this.serialize(entity))
        this.validateSerializedLines(nextLines)

        await this.ensureParentDirectory()
        await writeFile(this.filePath, `${nextLines.join("\n")}\n`, "utf8")
        return entity
      },
      catch: (error) => this.mapWriteError(error),
    })
  }

  get(id: string): Effect.Effect<T, JsonlRepositoryError> {
    return Effect.tryPromise({
      try: async () => {
        const state = await this.readState()
        const record = state.activeRecords.find((candidate) => candidate.entity.id === id)
        if (!record) {
          throw this.notFoundError(id)
        }

        return record.entity
      },
      catch: (error) => this.mapReadError(error),
    })
  }

  list(): Effect.Effect<readonly T[], JsonlRepositoryError> {
    return Effect.tryPromise({
      try: async () => {
        const state = await this.readState()
        return state.activeRecords.map((record) => record.entity)
      },
      catch: (error) => this.mapReadError(error),
    })
  }

  update(entity: T): Effect.Effect<T, JsonlRepositoryError> {
    return Effect.tryPromise({
      try: async () => {
        const state = await this.readState()
        const targetLine = this.findActiveRecordLine(state.activeRecords, entity.id)
        if (targetLine === undefined) {
          throw this.notFoundError(entity.id)
        }

        const nextRecords = state.records.map((record) =>
          record.line === targetLine ? entity : record.entity
        )
        const nextLines = nextRecords.map((record) => this.serialize(record))
        this.validateSerializedLines(nextLines)
        await this.atomicRewrite(nextLines)
        return entity
      },
      catch: (error) => this.mapWriteError(error),
    })
  }

  tombstone(id: string, deletedAt?: string): Effect.Effect<T, JsonlRepositoryError> {
    const timestamp = deletedAt
      ? Effect.succeed(deletedAt)
      : Effect.map(Clock.currentTimeMillis, (currentTimeMillis) =>
          new Date(currentTimeMillis).toISOString()
        )

    return Effect.flatMap(timestamp, (resolvedDeletedAt) =>
      Effect.tryPromise({
        try: async () => {
          const state = await this.readState()
          const targetLine = this.findActiveRecordLine(state.activeRecords, id)
          if (targetLine === undefined) {
            throw this.notFoundError(id)
          }

          let tombstonedRecord: T | undefined
          const nextRecords = state.records.map((record) => {
            if (record.line !== targetLine) {
              return record.entity
            }

            tombstonedRecord = {
              ...record.entity,
              updatedAt: resolvedDeletedAt,
              deletedAt: resolvedDeletedAt,
            }
            return tombstonedRecord
          })

          if (!tombstonedRecord) {
            throw this.notFoundError(id)
          }

          const nextLines = nextRecords.map((record) => this.serialize(record))
          this.validateSerializedLines(nextLines)
          await this.atomicRewrite(nextLines)
          return tombstonedRecord
        },
        catch: (error) => this.mapWriteError(error),
      })
    )
  }

  private async readState(): Promise<RepositoryState<T>> {
    const content = await readFile(this.filePath, "utf8").catch((error: unknown) => {
      if (isEnoent(error) && this.initialized) {
        return ""
      }

      throw isEnoent(error)
        ? this.storageError("read", `Canonical file is missing: ${this.filePath}`, error)
        : error
    })

    return this.parseContent(content)
  }

  private parseContent(content: string): RepositoryState<T> {
    const records: ParsedRecord<T>[] = []
    const activeRecords: ParsedRecord<T>[] = []
    const activeLinesById = new Map<string, number>()
    const validationDetails: ValidationDetail[] = []
    let nonEmptyLineCount = 0

    for (const [index, rawLine] of splitPreservingNumbers(content).entries()) {
      const line = index + 1
      if (rawLine.trim().length === 0) {
        continue
      }

      nonEmptyLineCount += 1
      if (nonEmptyLineCount > this.maxScanLines) {
        throw this.storageError("read", `Entity scan exceeded ${this.maxScanLines} non-empty lines`)
      }

      if (byteLength(rawLine) > this.maxLineBytes) {
        throw this.malformedRecordError(line, "line_too_long", "JSONL line exceeds byte limit")
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawLine)
      } catch {
        throw this.malformedRecordError(line, "invalid_json", "JSONL line is not valid JSON")
      }

      const parsed = this.schema.safeParse(parsedJson)
      if (!parsed.success) {
        if (validationDetails.length < this.maxValidationErrors) {
          validationDetails.push({
            filePath: this.filePath,
            line,
            entityKind: readEntityKind(parsedJson),
            issues: parsed.error.issues.map((issue) => issue.message),
          })
        }
        continue
      }

      const record = { entity: parsed.data, line } satisfies ParsedRecord<T>
      records.push(record)
      if (record.entity.deletedAt !== undefined) {
        continue
      }

      const conflictingLine = activeLinesById.get(record.entity.id)
      if (conflictingLine !== undefined) {
        throw this.conflictError(record.entity.id, line, conflictingLine)
      }

      activeLinesById.set(record.entity.id, line)
      activeRecords.push(record)
    }

    if (validationDetails.length > 0) {
      const truncated = validationDetails.length >= this.maxValidationErrors
      throw this.validationError(validationDetails, truncated)
    }

    return { records, activeRecords }
  }

  private validateSerializedLines(lines: readonly string[]): void {
    this.parseContent(lines.length === 0 ? "" : `${lines.join("\n")}\n`)
  }

  private serialize(entity: T): string {
    return JSON.stringify(entity)
  }

  private async atomicRewrite(lines: readonly string[]): Promise<void> {
    await this.ensureParentDirectory()

    let lastError: unknown
    for (let attempt = 0; attempt < MAX_TEMP_SUFFIX_ATTEMPTS; attempt += 1) {
      const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${attempt}`
      try {
        await writeFile(tempPath, lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8")
        await rename(tempPath, this.filePath)
        return
      } catch (error) {
        lastError = error
      }
    }

    throw this.storageError("write", "Atomic rewrite temp suffix attempts exhausted", lastError)
  }

  private async ensureParentDirectory(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
  }

  private findActiveRecordLine(
    activeRecords: readonly ParsedRecord<T>[],
    id: string
  ): number | undefined {
    return activeRecords.find((record) => record.entity.id === id)?.line
  }

  private notFoundError(id: string): JsonlRepositoryError {
    return {
      _tag: "not_found",
      message: `${this.entityName} ${id} was not found`,
      filePath: this.filePath,
      id,
    }
  }

  private conflictError(id: string, line: number, conflictingLine: number): JsonlRepositoryError {
    return {
      _tag: "conflict",
      message: `Duplicate active ${this.entityName} id ${id}`,
      filePath: this.filePath,
      id,
      line,
      conflictingLine,
    }
  }

  private malformedRecordError(
    line: number,
    reason: "invalid_json" | "line_too_long",
    message: string
  ): JsonlRepositoryError {
    return {
      _tag: "malformed_record",
      message,
      filePath: this.filePath,
      line,
      reason,
    }
  }

  private validationError(
    details: readonly ValidationDetail[],
    truncated: boolean
  ): JsonlRepositoryError {
    return {
      _tag: "validation_error",
      message: `Invalid ${this.entityName} records found in ${this.filePath}`,
      filePath: this.filePath,
      details,
      truncated,
    }
  }

  private storageError(
    operation: "read" | "write",
    message: string,
    cause?: unknown
  ): JsonlRepositoryError {
    return {
      _tag: "storage_error",
      message,
      filePath: this.filePath,
      operation,
      cause,
    }
  }

  private mapReadError(error: unknown): JsonlRepositoryError {
    return isJsonlRepositoryError(error)
      ? error
      : this.storageError("read", `Failed to read ${this.filePath}`, error)
  }

  private mapWriteError(error: unknown): JsonlRepositoryError {
    return isJsonlRepositoryError(error)
      ? error
      : this.storageError("write", `Failed to write ${this.filePath}`, error)
  }
}

const splitPreservingNumbers = (content: string): readonly string[] => content.split(/\r?\n/u)

const byteLength = (value: string): number => textEncoder.encode(value).length

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"

const readEntityKind = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return undefined
  }

  const entityKind = (value as { kind?: unknown }).kind
  return typeof entityKind === "string" ? entityKind : undefined
}

const isJsonlRepositoryError = (error: unknown): error is JsonlRepositoryError =>
  typeof error === "object" && error !== null && "_tag" in error
