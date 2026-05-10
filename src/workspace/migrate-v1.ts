import { readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import { atomicWriteJsonl } from "@logbook/shared/storage/atomic-write.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { fromV1TaskInput } from "@logbook/task/v1-compat.js"
import { type Clock, Effect } from "effect"
import { resolveWorkspacePaths } from "./storage-layout.js"

const MAX_V1_TASK_LINES = 100_000
const MAX_ENTITY_LINE_BYTES = 1_048_576
const MAX_VALIDATION_ERRORS = 50
const textEncoder = new TextEncoder()

export type V1WorkspaceMigrationInput = {
  readonly path?: string | undefined
  readonly now?: string | undefined
}

export type V1WorkspaceMigrationResult = {
  readonly migrated: boolean
  readonly taskCount: number
}

type MigrationWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]

type ValidationDetail = {
  readonly filePath: string
  readonly line: number
  readonly issues: readonly string[]
}

type MigrationError = {
  readonly code: "malformed_record" | "validation_error" | "storage_error" | "workspace_error"
  readonly message: string
  readonly details?: Record<string, unknown>
}

type ParsedLine = {
  readonly line: number
  readonly value: unknown
}

export const migrateV1Workspace = (
  input: V1WorkspaceMigrationInput = {}
): Effect.Effect<ToolResult<V1WorkspaceMigrationResult>, never, Clock.Clock> =>
  Effect.gen(function* () {
    const timestamp = input.now ?? (yield* nowIso())
    return yield* Effect.promise(() => migrateV1WorkspaceUnsafe(input, timestamp))
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.succeed({
        ok: false as const,
        error: storageError(
          resolve(input.path ?? process.cwd()),
          "read",
          "Failed to migrate v1 workspace.",
          {
            cause: String(cause),
          }
        ),
      })
    )
  )

const migrateV1WorkspaceUnsafe = async (
  input: V1WorkspaceMigrationInput,
  now: string
): Promise<ToolResult<V1WorkspaceMigrationResult>> => {
  const workspaceRoot = resolve(input.path ?? process.cwd())
  const sourcePath = join(workspaceRoot, "tasks.jsonl")
  const targetPath = resolveWorkspacePaths(workspaceRoot).tasks

  try {
    const source = await stat(sourcePath).catch((cause: unknown) => {
      if (isEnoent(cause)) {
        return null
      }
      throw cause
    })
    if (source === null) {
      return { ok: true, data: { migrated: false, taskCount: 0 } }
    }
    if (!source.isFile()) {
      return {
        ok: false,
        error: workspaceError("V1 task storage path is not a file.", { filePath: sourcePath }),
      }
    }

    const target = await stat(targetPath).catch((cause: unknown) => {
      if (isEnoent(cause)) {
        return null
      }
      throw cause
    })
    if (target !== null && !target.isFile()) {
      return {
        ok: false,
        error: workspaceError("Canonical v2 task storage path is not a file.", {
          filePath: targetPath,
        }),
      }
    }
    if (target !== null && target.size > 0) {
      return {
        ok: false,
        error: storageError(targetPath, "write", "Canonical v2 task storage already has content.", {
          filePath: targetPath,
        }),
      }
    }

    const content = await readFile(sourcePath, "utf8")
    const parsed = parseV1Jsonl(content, sourcePath)
    if (!parsed.ok) {
      return parsed
    }

    const translated = translateTasks(parsed.data, sourcePath, now)
    if (!translated.ok) {
      return translated
    }

    const lines = translated.data.tasks.map((task) => JSON.stringify(task))
    const writeResult = await Effect.runPromiseExit(
      atomicWriteJsonl({
        filePath: targetPath,
        lines,
        validateLine: (value) => {
          TaskSchema.parse(value)
        },
      })
    )

    if (writeResult._tag === "Failure") {
      return {
        ok: false,
        error: storageError(targetPath, "write", "Failed to write migrated v2 task storage.", {
          cause: String(writeResult.cause),
        }),
      }
    }

    return {
      ok: true,
      data: { migrated: lines.length > 0, taskCount: lines.length },
      ...(translated.data.warnings.length === 0 ? {} : { warnings: [...translated.data.warnings] }),
    }
  } catch (cause) {
    return {
      ok: false,
      error: storageError(sourcePath, "read", "Failed to migrate v1 workspace.", {
        cause: String(cause),
      }),
    }
  }
}

const parseV1Jsonl = (content: string, filePath: string): ToolResult<readonly ParsedLine[]> => {
  const records: ParsedLine[] = []
  let nonEmptyLineCount = 0

  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const line = index + 1
    if (rawLine.trim().length === 0) {
      continue
    }

    nonEmptyLineCount += 1
    if (nonEmptyLineCount > MAX_V1_TASK_LINES) {
      return {
        ok: false,
        error: storageError(
          filePath,
          "read",
          `V1 task migration exceeded ${MAX_V1_TASK_LINES} lines.`,
          {
            filePath,
            maxLines: MAX_V1_TASK_LINES,
          }
        ),
      }
    }

    if (byteLength(rawLine) > MAX_ENTITY_LINE_BYTES) {
      return {
        ok: false,
        error: malformedRecordError(
          filePath,
          line,
          "line_too_long",
          "V1 task JSONL line exceeds byte limit."
        ),
      }
    }

    try {
      records.push({ line, value: JSON.parse(rawLine) })
    } catch {
      return {
        ok: false,
        error: malformedRecordError(
          filePath,
          line,
          "invalid_json",
          "V1 task JSONL line is not valid JSON."
        ),
      }
    }
  }

  return { ok: true, data: records }
}

const translateTasks = (
  records: readonly ParsedLine[],
  filePath: string,
  now: string
): ToolResult<{ readonly tasks: readonly Task[]; readonly warnings: MigrationWarning[] }> => {
  const tasks: Task[] = []
  const warnings: MigrationWarning[] = []
  const validationDetails: ValidationDetail[] = []
  const linesByTaskId = new Map<string, number>()
  let validationErrorCount = 0

  for (const record of records) {
    const createdAt = readTimestamp(record.value, ["createdAt", "created_at", "timestamp"])
    const normalized = normalizeV1Record(record.value)
    const translated = fromV1TaskInput(normalized, { now: createdAt ?? now })

    if (!translated.ok) {
      validationErrorCount += 1
      if (validationDetails.length < MAX_VALIDATION_ERRORS) {
        validationDetails.push({
          filePath,
          line: record.line,
          issues: readIssues(translated.error.details),
        })
      }
      continue
    }

    const assignee = readAssignee(record.value)
    const task = {
      ...translated.data,
      ...(assignee === undefined ? {} : { assignee }),
      updatedAt:
        readTimestamp(record.value, ["updatedAt", "updated_at"]) ?? translated.data.createdAt,
      comments: translated.data.comments.map((comment) => ({
        ...comment,
        createdAt: toIsoString(comment.createdAt),
        replies: comment.replies.map((reply) => ({
          ...reply,
          createdAt: toIsoString(reply.createdAt),
        })),
      })),
    }

    const validated = TaskSchema.safeParse(task)
    if (!validated.success) {
      validationErrorCount += 1
      if (validationDetails.length < MAX_VALIDATION_ERRORS) {
        validationDetails.push({
          filePath,
          line: record.line,
          issues: validated.error.issues.map((issue) => issue.message),
        })
      }
      continue
    }

    const conflictingLine = linesByTaskId.get(validated.data.id)
    if (conflictingLine !== undefined) {
      validationErrorCount += 1
      if (validationDetails.length < MAX_VALIDATION_ERRORS) {
        validationDetails.push({
          filePath,
          line: record.line,
          issues: [`Duplicate task id ${validated.data.id}; first seen on line ${conflictingLine}`],
        })
      }
      continue
    }

    if (createdAt === undefined) {
      warnings.push({
        code: "missing_created_at",
        message: "V1 task has no creation timestamp; migration timestamp was used.",
        details: { filePath, line: record.line, taskId: validated.data.id },
      })
    }
    linesByTaskId.set(validated.data.id, record.line)
    tasks.push(validated.data)
  }

  if (validationErrorCount > 0) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: `Invalid v1 task records found in ${filePath}.`,
        details: {
          filePath,
          details: validationDetails,
          truncated: validationErrorCount > validationDetails.length,
        },
      },
    }
  }

  return { ok: true, data: { tasks, warnings } }
}

const normalizeV1Record = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value
  }

  const {
    createdAt: _createdAt,
    created_at: _created_at,
    updatedAt: _updatedAt,
    updated_at: _updated_at,
    timestamp: _timestamp,
    assignee: _assignee,
    ...v1
  } = value

  return {
    ...v1,
    definition_of_done: normalizeStringList(value.definition_of_done),
    test_cases: normalizeStringList(value.test_cases),
    comments: Array.isArray(value.comments)
      ? value.comments.map((comment) =>
          isRecord(comment) ? { ...comment, timestamp: toIsoString(comment.timestamp) } : comment
        )
      : value.comments,
    in_progress_since:
      value.in_progress_since === undefined ? undefined : toIsoString(value.in_progress_since),
  }
}

const readAssignee = (value: unknown): unknown | undefined => {
  if (!isRecord(value) || !("assignee" in value)) {
    return undefined
  }

  return value.assignee
}

const normalizeStringList = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  )
}

const readTimestamp = (value: unknown, keys: readonly string[]): string | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  for (const key of keys) {
    if (key in value) {
      const timestamp = toIsoString(value[key])
      if (timestamp.length > 0) {
        return timestamp
      }
    }
  }

  return undefined
}

const toIsoString = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return ""
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

const readIssues = (details: Record<string, unknown> | undefined): readonly string[] => {
  const issues = details?.issues
  if (Array.isArray(issues)) {
    return issues.filter((issue): issue is string => typeof issue === "string")
  }

  return ["validation failed"]
}

const byteLength = (value: string): number => textEncoder.encode(value).length

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEnoent = (error: unknown): boolean =>
  isRecord(error) && "code" in error && error.code === "ENOENT"

const malformedRecordError = (
  filePath: string,
  line: number,
  reason: "invalid_json" | "line_too_long",
  message: string
): MigrationError => ({
  code: "malformed_record",
  message,
  details: { filePath, line, reason },
})

const storageError = (
  filePath: string,
  operation: "read" | "write",
  message: string,
  details?: Record<string, unknown>
): MigrationError => ({
  code: "storage_error",
  message,
  details: { filePath, operation, ...(details ?? {}) },
})

const workspaceError = (message: string, details?: Record<string, unknown>): MigrationError => ({
  code: "workspace_error",
  message,
  ...(details === undefined ? {} : { details }),
})
