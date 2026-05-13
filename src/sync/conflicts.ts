import { ContextEntrySchema } from "@logbook/context/schema.js"
import { EpicSchema } from "@logbook/epic/schema.js"
import { createId } from "@logbook/shared/ids.js"
import { PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import {
  LocalRecordRefSchema,
  SyncConflictFieldSchema,
} from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { StorySchema } from "@logbook/story/schema.js"
import { type SyncConflict, SyncConflictSchema } from "@logbook/sync/schema.js"
import { TaskSchema } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"
import { z } from "zod"

const DEFAULT_LIST_LIMIT = 200
const MAX_LIST_LIMIT = 200
const MAX_CONFLICT_FIELDS = 100
const MAX_DETAIL_JSON_BYTES = 65_536
const SYNC_CONFLICT_CURSOR_KIND = "sync_conflict.list.v1"
const textEncoder = new TextEncoder()

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

const SyncConflictRepository =
  Context.GenericTag<SyncConflictRepositoryShape>("SyncConflictRepository")

const RemoteRecordSchema = SyncConflictSchema.shape.remoteRecord

const CreateSyncConflictInputSchema = z
  .object({
    provider: z.string().min(1),
    localRecord: LocalRecordRefSchema,
    remoteRecord: RemoteRecordSchema,
    fields: z.array(SyncConflictFieldSchema).min(1).max(MAX_CONFLICT_FIELDS),
  })
  .strict()

type CreateSyncConflictInput = z.input<typeof CreateSyncConflictInputSchema>

type MergeDecisionAction = "accept_remote" | "keep_local" | "skip" | "merge" | "conflict"

type MergeDecision = {
  readonly action: MergeDecisionAction
  readonly fields: readonly string[]
}

type SyncConflictEventData =
  | {
      readonly result: "conflict"
      readonly providerId: string
      readonly conflictId: string
      readonly entityType: string
      readonly entityId: string
      readonly fields: readonly string[]
    }
  | {
      readonly result: "resolved"
      readonly providerId: string
      readonly conflictId: string
      readonly resolution: "use_local" | "use_remote" | "manual"
      readonly fields: readonly string[]
    }

type CreateSyncConflictResult = {
  readonly decision: MergeDecision
  readonly conflict?: SyncConflict
  readonly event?: SyncConflictEventData
}

const ListSyncConflictsInputSchema = z
  .object({
    provider: z.string().min(1).optional(),
    status: SyncConflictSchema.shape.status.optional(),
    limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict()

type ListSyncConflictsInput = z.input<typeof ListSyncConflictsInputSchema>

type ListSyncConflictsResult = {
  readonly items: readonly SyncConflict[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

const ResolutionSchema = z.enum(["use_local", "use_remote", "manual"])

const ManualResolutionRecordSchema = z
  .object({
    entityType: z.enum(["task", "epic", "story", "context"]),
    entityId: z.string().min(1),
    fields: z.record(z.string().min(1), z.unknown()),
    rationale: z.string().min(1),
    resolvedBy: z.string().min(1).optional(),
  })
  .strict()

const ResolveSyncConflictInputSchema = z
  .object({
    id: z.string().min(1),
    resolution: ResolutionSchema,
    manualRecord: ManualResolutionRecordSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.resolution === "manual" && input.manualRecord === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualRecord"],
        message: "manualRecord is required when resolution is manual",
      })
    }
    if (input.resolution !== "manual" && input.manualRecord !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manualRecord"],
        message: "manualRecord is only accepted when resolution is manual",
      })
    }
  })

type ResolveSyncConflictInput = z.input<typeof ResolveSyncConflictInputSchema>

type ResolveSyncConflictResult = {
  readonly conflict: SyncConflict
  readonly event: SyncConflictEventData
}

export const createSyncConflict = (
  input: CreateSyncConflictInput
): Effect.Effect<
  ToolResult<CreateSyncConflictResult>,
  never,
  SyncConflictRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const parsedInput = CreateSyncConflictInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const fieldValidation = validateConflictFields(parsedInput.data.fields)
    if (!fieldValidation.ok) {
      return fieldValidation
    }

    const decisions = parsedInput.data.fields.map(decideFieldMerge)
    const conflictFields = decisions
      .filter((decision) => decision.action === "conflict")
      .map((decision) => decision.field)
    const decision = summarizeDecisions(decisions)

    if (conflictFields.length === 0) {
      return {
        ok: true,
        data: {
          decision,
        },
      }
    }

    const timestamp = yield* nowIso()
    const conflictResult = parseSyncConflict({
      id: createId("sync_conflict"),
      schemaVersion: "2" as const,
      kind: "sync_conflict" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      provider: parsedInput.data.provider,
      localRecord: parsedInput.data.localRecord,
      remoteRecord: parsedInput.data.remoteRecord,
      fields: conflictFields.map(sanitizeConflictField),
      status: "open" as const,
    })
    if (!conflictResult.ok) {
      return conflictResult
    }

    const repo = (yield* SyncConflictRepository) as unknown as SyncConflictRepositoryShape
    const saved = yield* Effect.either(repo.create(conflictResult.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        decision,
        conflict: saved.right,
        event: conflictEvent(saved.right),
      },
    }
  })

export const listSyncConflicts = (
  input: ListSyncConflictsInput
): Effect.Effect<ToolResult<ListSyncConflictsResult>, never, SyncConflictRepositoryShape> =>
  Effect.gen(function* () {
    const parsedInput = ListSyncConflictsInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* SyncConflictRepository) as unknown as SyncConflictRepositoryShape
    const listed = yield* Effect.either(repo.list())
    if (listed._tag === "Left") {
      return repositoryError(listed.left)
    }

    const cursorResult =
      parsedInput.data.cursor === undefined
        ? undefined
        : PageCursor.decode(parsedInput.data.cursor, {
            kind: SYNC_CONFLICT_CURSOR_KIND,
            sortShape: ["string"],
          })
    if (cursorResult !== undefined && !cursorResult.ok) {
      return cursorResult
    }

    const limit = parsedInput.data.limit ?? DEFAULT_LIST_LIMIT
    const filtered = listed.right
      .filter((conflict) => matchesListInput(conflict, parsedInput.data))
      .sort(compareSyncConflicts)
      .filter((conflict) =>
        cursorResult === undefined
          ? true
          : compareCursor(
              conflict,
              cursorResult.data.lastSort[0] as string,
              cursorResult.data.lastId
            ) > 0
      )

    const items = filtered.slice(0, limit)
    const hasMore = filtered.length > limit
    if (!hasMore) {
      return {
        ok: true,
        data: {
          items,
          hasMore,
        },
      }
    }

    const lastConflict = items[items.length - 1]
    if (lastConflict === undefined) {
      return malformedRecordError(
        "Cannot build a continuation cursor for an empty sync conflict page."
      )
    }

    const nextCursor = PageCursor.encode({
      kind: SYNC_CONFLICT_CURSOR_KIND,
      lastId: lastConflict.id,
      lastSort: [lastConflict.createdAt],
    })
    if (!nextCursor.ok) {
      return nextCursor
    }

    return {
      ok: true,
      data: {
        items,
        hasMore,
        nextCursor: nextCursor.data,
      },
      warnings: [
        {
          code: "result_truncated",
          message: "Sync conflict list exceeded the 200 item limit.",
          details: {
            limit,
            hasMore,
            nextCursor: nextCursor.data,
          },
        },
      ],
    }
  })

export const resolveSyncConflict = (
  input: ResolveSyncConflictInput
): Effect.Effect<
  ToolResult<ResolveSyncConflictResult>,
  never,
  SyncConflictRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const parsedInput = ResolveSyncConflictInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* SyncConflictRepository) as unknown as SyncConflictRepositoryShape
    const existing = yield* Effect.either(repo.get(parsedInput.data.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    if (existing.right.status !== "open") {
      return validationError(["Only open sync conflicts can be resolved."])
    }

    if (parsedInput.data.resolution === "manual") {
      const manualValidation = validateManualResolution(
        existing.right,
        parsedInput.data.manualRecord
      )
      if (!manualValidation.ok) {
        return manualValidation
      }
    }

    const timestamp = yield* nowIso()
    const next = parseSyncConflict({
      ...existing.right,
      updatedAt: timestamp,
      status: "resolved" as const,
      resolution: parsedInput.data.resolution,
      resolvedAt: timestamp,
    })
    if (!next.ok) {
      return next
    }

    const saved = yield* Effect.either(repo.update(next.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        conflict: saved.right,
        event: resolvedEvent(saved.right),
      },
    }
  })

const decideFieldMerge = (
  field: z.output<typeof SyncConflictFieldSchema>
): {
  readonly action: MergeDecisionAction
  readonly field: z.output<typeof SyncConflictFieldSchema>
} => {
  const localChanged = !deepEqual(field.localValue, field.baseValue)
  const remoteChanged = !deepEqual(field.remoteValue, field.baseValue)

  if (!localChanged && remoteChanged) {
    return { action: "accept_remote", field }
  }
  if (localChanged && !remoteChanged) {
    return { action: "keep_local", field }
  }
  if (deepEqual(field.localValue, field.remoteValue)) {
    return { action: "skip", field }
  }

  return { action: "conflict", field }
}

const summarizeDecisions = (
  decisions: readonly {
    readonly action: MergeDecisionAction
    readonly field: z.output<typeof SyncConflictFieldSchema>
  }[]
): MergeDecision => {
  const conflictFields = decisions
    .filter((decision) => decision.action === "conflict")
    .map((decision) => decision.field.path)
  if (conflictFields.length > 0) {
    return {
      action: "conflict",
      fields: conflictFields,
    }
  }

  const actions = new Set(decisions.map((decision) => decision.action))
  const fields = decisions.map((decision) => decision.field.path)
  if (actions.size === 1) {
    const action = decisions[0]?.action ?? "skip"
    return {
      action,
      fields,
    }
  }

  return {
    action: "merge",
    fields,
  }
}

const validateConflictFields = (
  fields: readonly z.output<typeof SyncConflictFieldSchema>[]
): ToolResult<undefined> => {
  for (const field of fields) {
    const jsonValidation = validateJsonishConflictField(field)
    if (!jsonValidation.ok) {
      return jsonValidation
    }
  }

  return {
    ok: true,
    data: undefined,
  }
}

const validateJsonishConflictField = (
  field: z.output<typeof SyncConflictFieldSchema>
): ToolResult<undefined> => {
  for (const [key, value] of Object.entries(field)) {
    if (key === "path") {
      continue
    }
    if (!isJsonValue(value)) {
      return validationError([`conflict field ${field.path}.${key} must be JSON-serializable`])
    }
  }

  return {
    ok: true,
    data: undefined,
  }
}

const sanitizeConflictField = (
  field: z.output<typeof SyncConflictFieldSchema>
): z.output<typeof SyncConflictFieldSchema> => {
  const sanitized: z.output<typeof SyncConflictFieldSchema> = {
    path: field.path,
    localValue: truncateDetailValue(field.localValue),
    remoteValue: truncateDetailValue(field.remoteValue),
  }

  if (Object.hasOwn(field, "baseValue")) {
    sanitized.baseValue = truncateDetailValue(field.baseValue)
  }

  return sanitized
}

const truncateDetailValue = (value: unknown): unknown => {
  const serialized = JSON.stringify(value)
  if (serialized === undefined || byteLength(serialized) <= MAX_DETAIL_JSON_BYTES) {
    return value
  }

  return {
    truncated: true,
    originalBytes: byteLength(serialized),
    preview: serialized.slice(0, 4_096),
  }
}

const validateManualResolution = (
  conflict: SyncConflict,
  manualRecord: z.output<typeof ManualResolutionRecordSchema> | undefined
): ToolResult<undefined> => {
  if (manualRecord === undefined) {
    return validationError(["manualRecord is required when resolution is manual"])
  }

  const entityType = publicEntityType(conflict.localRecord.kind)
  if (manualRecord.entityType !== entityType || manualRecord.entityId !== conflict.localRecord.id) {
    return validationError(["manualRecord must target the conflicted local record"])
  }

  const allowedFields = new Set(conflict.fields.map((field) => field.path))
  const extraFields = Object.keys(manualRecord.fields).filter((field) => !allowedFields.has(field))
  if (extraFields.length > 0) {
    return validationError(
      ["manualRecord.fields contains fields not present in the conflict field set"],
      {
        extraFields,
        allowedFields: [...allowedFields],
      }
    )
  }

  const localRecordValidation = validateBoundaryRecord(conflict.localRecord.kind, {
    id: manualRecord.entityId,
    kind: conflict.localRecord.kind,
    ...manualRecord.fields,
  })
  if (!localRecordValidation.ok) {
    return localRecordValidation
  }

  return {
    ok: true,
    data: undefined,
  }
}

const validateBoundaryRecord = (
  kind: SyncConflict["localRecord"]["kind"],
  candidate: Record<string, unknown>
): ToolResult<undefined> => {
  const schema = (() => {
    switch (kind) {
      case "task":
        return TaskSchema.partial().required({ id: true, kind: true })
      case "epic":
        return EpicSchema.partial().required({ id: true, kind: true })
      case "story":
        return StorySchema.partial().required({ id: true, kind: true })
      case "context_entry":
        return ContextEntrySchema.partial().required({ id: true, kind: true })
    }
  })()
  const parsed = schema.safeParse(candidate)

  return parsed.success
    ? {
        ok: true,
        data: undefined,
      }
    : validationError(parsed.error.issues.map((issue) => issue.message))
}

const parseSyncConflict = (value: unknown): ToolResult<SyncConflict> => {
  const parsed = SyncConflictSchema.safeParse(value)
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((issue) => issue.message))
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

const conflictEvent = (conflict: SyncConflict): SyncConflictEventData => ({
  result: "conflict",
  providerId: conflict.provider,
  conflictId: conflict.id,
  entityType: publicEntityType(conflict.localRecord.kind),
  entityId: conflict.localRecord.id,
  fields: conflict.fields.map((field) => field.path),
})

const resolvedEvent = (conflict: SyncConflict): SyncConflictEventData => ({
  result: "resolved",
  providerId: conflict.provider,
  conflictId: conflict.id,
  resolution: conflict.resolution ?? "manual",
  fields: conflict.fields.map((field) => field.path),
})

const publicEntityType = (
  kind: SyncConflict["localRecord"]["kind"]
): "task" | "epic" | "story" | "context" => {
  switch (kind) {
    case "task":
      return "task"
    case "epic":
      return "epic"
    case "story":
      return "story"
    case "context_entry":
      return "context"
  }
}

const matchesListInput = (
  conflict: SyncConflict,
  input: z.output<typeof ListSyncConflictsInputSchema>
): boolean => {
  if (conflict.deletedAt !== undefined) {
    return false
  }
  if (input.provider !== undefined && conflict.provider !== input.provider) {
    return false
  }

  return input.status === undefined || conflict.status === input.status
}

const compareSyncConflicts = (left: SyncConflict, right: SyncConflict): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)

const compareCursor = (conflict: SyncConflict, cursorCreatedAt: string, cursorId: string): number =>
  conflict.createdAt.localeCompare(cursorCreatedAt) || conflict.id.localeCompare(cursorId)

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && arraysEqual(left, right)
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    return isPlainRecord(left) && isPlainRecord(right) && recordsEqual(left, right)
  }

  return false
}

const arraysEqual = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))

const recordsEqual = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  return (
    arraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]))
  )
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isJsonValue = (value: unknown): boolean => {
  if (value === null) {
    return true
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return true
    case "number":
      return Number.isFinite(value)
    case "object":
      if (Array.isArray(value)) {
        return value.every(isJsonValue)
      }

      return Object.values(value as Record<string, unknown>).every(isJsonValue)
    default:
      return false
  }
}

const validationError = (
  issues: readonly string[],
  details?: Record<string, unknown>
): ToolResult<never> =>
  ({
    ok: false,
    error: {
      code: "validation_error",
      message: issues[0] ?? "validation failed",
      details: truncateDetails({
        issues,
        ...(details ?? {}),
      }),
    },
  }) as ToolResult<never>

const malformedRecordError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> =>
  ({
    ok: false,
    error: {
      code: "malformed_record",
      message,
      ...(details === undefined ? {} : { details: truncateDetails(details) }),
    },
  }) as ToolResult<never>

const repositoryError = (error: unknown): ToolResult<never> => {
  if (isRepositoryError(error)) {
    return {
      ok: false,
      error: {
        code: mapRepositoryErrorCode(error._tag),
        message: error.message,
        details: truncateDetails({
          repositoryTag: error._tag,
        }),
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "Sync conflict repository operation failed.",
    },
  }
}

const isRepositoryError = (
  error: unknown
): error is { readonly _tag: string; readonly message: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof (error as { readonly _tag?: unknown })._tag === "string" &&
  "message" in error &&
  typeof (error as { readonly message?: unknown }).message === "string"

const mapRepositoryErrorCode = (
  tag: string
): "conflict" | "not_found" | "validation_error" | "malformed_record" | "storage_error" => {
  switch (tag) {
    case "conflict":
      return "conflict"
    case "not_found":
      return "not_found"
    case "validation_error":
      return "validation_error"
    case "malformed_record":
      return "malformed_record"
    default:
      return "storage_error"
  }
}

const truncateDetails = (details: Record<string, unknown>): Record<string, unknown> => {
  const serialized = JSON.stringify(details)
  if (serialized === undefined || byteLength(serialized) <= MAX_DETAIL_JSON_BYTES) {
    return details
  }

  return {
    truncated: true,
    originalBytes: byteLength(serialized),
    preview: serialized.slice(0, 4_096),
  }
}

const byteLength = (value: string): number => textEncoder.encode(value).length
