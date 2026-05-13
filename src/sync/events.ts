import { createId } from "@logbook/shared/ids.js"
import { PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type SyncEvent, SyncEventSchema } from "@logbook/sync/schema.js"
import { type Clock, Context, Effect } from "effect"
import { z } from "zod"

const DEFAULT_LIST_LIMIT = 500
const MAX_LIST_LIMIT = 500
const MAX_ENTITY_LINE_BYTES = 1_048_576
const SYNC_EVENT_CURSOR_KIND = "sync_event.list.v1"
const textEncoder = new TextEncoder()

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

const SyncEventRepository = Context.GenericTag<SyncEventRepositoryShape>("SyncEventRepository")

const SyncProviderErrorSchema = z
  .object({
    providerId: z.string().min(1),
    code: z.enum([
      "auth_failed",
      "rate_limited",
      "network_error",
      "timeout",
      "not_found",
      "validation_failed",
      "remote_conflict",
      "unknown",
    ]),
    retryable: z.boolean(),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const SyncEventDataSchema = z
  .discriminatedUnion("result", [
    z
      .object({
        result: z.literal("created"),
        providerId: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        remoteId: z.string().min(1),
        fields: z.array(z.string().min(1)),
      })
      .strict(),
    z
      .object({
        result: z.literal("updated"),
        providerId: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        remoteId: z.string().min(1),
        fields: z.array(z.string().min(1)),
      })
      .strict(),
    z
      .object({
        result: z.literal("skipped"),
        providerId: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1).optional(),
        remoteId: z.string().min(1).optional(),
        reason: z.enum(["unchanged", "dry_run", "filtered", "missing_mapping"]),
      })
      .strict(),
    z
      .object({
        result: z.literal("failed"),
        providerId: z.string().min(1),
        entityType: z.string().min(1).optional(),
        entityId: z.string().min(1).optional(),
        remoteId: z.string().min(1).optional(),
        error: SyncProviderErrorSchema,
      })
      .strict(),
    z
      .object({
        result: z.literal("conflict"),
        providerId: z.string().min(1),
        conflictId: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        fields: z.array(z.string().min(1)),
      })
      .strict(),
    z
      .object({
        result: z.literal("resolved"),
        providerId: z.string().min(1),
        conflictId: z.string().min(1),
        resolution: z.enum(["use_local", "use_remote", "manual"]),
        fields: z.array(z.string().min(1)),
      })
      .strict(),
  ])
  .superRefine((data, ctx) => {
    if (!isJsonValue(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sync event data must be JSON-serializable",
      })
    }
  })

type SyncEventData = z.output<typeof SyncEventDataSchema>

const AppendSyncEventInputSchema = z
  .object({
    direction: SyncEventSchema.shape.direction,
    message: z.string().min(1).optional(),
    data: SyncEventDataSchema,
  })
  .strict()

type AppendSyncEventInput = z.input<typeof AppendSyncEventInputSchema>

type AppendSyncEventResult = {
  readonly syncEvent: SyncEvent
}

const ListSyncEventsInputSchema = z
  .object({
    provider: z.string().min(1).optional(),
    direction: SyncEventSchema.shape.direction.optional(),
    result: SyncEventSchema.shape.result.optional(),
    localRecordId: z.string().min(1).optional(),
    remoteRecordId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict()

type ListSyncEventsInput = z.input<typeof ListSyncEventsInputSchema>

type ListSyncEventsResult = {
  readonly syncEvents: readonly SyncEvent[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export const appendSyncEvent = (
  input: AppendSyncEventInput
): Effect.Effect<
  ToolResult<AppendSyncEventResult>,
  never,
  SyncEventRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const parsedInput = AppendSyncEventInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const timestamp = yield* nowIso()
    const eventResult = buildSyncEvent(parsedInput.data, timestamp)
    if (!eventResult.ok) {
      return eventResult
    }

    const repo = (yield* SyncEventRepository) as unknown as SyncEventRepositoryShape
    const saved = yield* Effect.either(repo.create(eventResult.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        syncEvent: saved.right,
      },
    }
  })

export const listSyncEvents = (
  input: ListSyncEventsInput
): Effect.Effect<ToolResult<ListSyncEventsResult>, never, SyncEventRepositoryShape> =>
  Effect.gen(function* () {
    const parsedInput = ListSyncEventsInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* SyncEventRepository) as unknown as SyncEventRepositoryShape
    const listed = yield* Effect.either(repo.list())
    if (listed._tag === "Left") {
      return repositoryError(listed.left)
    }

    const limit = parsedInput.data.limit ?? DEFAULT_LIST_LIMIT
    const cursorResult =
      parsedInput.data.cursor === undefined
        ? undefined
        : PageCursor.decode(parsedInput.data.cursor, {
            kind: SYNC_EVENT_CURSOR_KIND,
            sortShape: ["string"],
          })
    if (cursorResult !== undefined && !cursorResult.ok) {
      return cursorResult
    }

    const filtered = listed.right
      .filter((event) => matchesListInput(event, parsedInput.data))
      .sort(compareSyncEvents)
      .filter((event) =>
        cursorResult === undefined
          ? true
          : compareCursor(
              event,
              cursorResult.data.lastSort[0] as string,
              cursorResult.data.lastId
            ) > 0
      )

    const page = filtered.slice(0, limit)
    const hasMore = filtered.length > limit
    if (!hasMore) {
      return {
        ok: true,
        data: {
          syncEvents: page,
          hasMore,
        },
      }
    }

    const lastEvent = page[page.length - 1]
    if (lastEvent === undefined) {
      return malformedRecordError(
        "Cannot build a continuation cursor for an empty sync event page."
      )
    }

    const nextCursor = PageCursor.encode({
      kind: SYNC_EVENT_CURSOR_KIND,
      lastId: lastEvent.id,
      lastSort: [lastEvent.createdAt],
    })
    if (!nextCursor.ok) {
      return nextCursor
    }

    return {
      ok: true,
      data: {
        syncEvents: page,
        hasMore,
        nextCursor: nextCursor.data,
      },
      warnings: [
        {
          code: "result_truncated",
          message: "Sync event list exceeded the 500 item limit.",
          details: {
            limit,
            hasMore,
            nextCursor: nextCursor.data,
          },
        },
      ],
    }
  })

const buildSyncEvent = (
  input: z.output<typeof AppendSyncEventInputSchema>,
  timestamp: string
): ToolResult<SyncEvent> => {
  const candidate = {
    id: createId("sync_event"),
    schemaVersion: "2" as const,
    kind: "sync_event" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    provider: input.data.providerId,
    direction: input.direction,
    result: input.data.result,
    message: input.message ?? deriveMessage(input.direction, input.data),
    data: input.data,
    ...optionalRecordIds(input.data),
  }

  const parsed = SyncEventSchema.safeParse(candidate)
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((issue) => issue.message))
  }

  const serialized = JSON.stringify(parsed.data)
  if (serialized === undefined || byteLength(serialized) > MAX_ENTITY_LINE_BYTES) {
    return malformedRecordError("Sync event JSONL line exceeds byte limit.", {
      maxBytes: MAX_ENTITY_LINE_BYTES,
    })
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

const optionalRecordIds = (
  data: SyncEventData
): Pick<SyncEvent, "localRecordId" | "remoteRecordId"> => {
  const recordIds: Partial<Pick<SyncEvent, "localRecordId" | "remoteRecordId">> = {}
  if ("entityId" in data && data.entityId !== undefined) {
    recordIds.localRecordId = data.entityId
  }
  if ("remoteId" in data && data.remoteId !== undefined) {
    recordIds.remoteRecordId = data.remoteId
  }

  return recordIds
}

const deriveMessage = (direction: SyncEvent["direction"], data: SyncEventData): string => {
  switch (data.result) {
    case "created":
      return `${direction} created ${data.entityType} ${data.entityId} with ${data.providerId} record ${data.remoteId}.`
    case "updated":
      return `${direction} updated ${data.entityType} ${data.entityId} with ${data.providerId} record ${data.remoteId}.`
    case "skipped":
      return `${direction} skipped ${data.entityType} for ${data.providerId}: ${data.reason}.`
    case "failed":
      return `${direction} failed for ${data.providerId}: ${data.error.message}`
    case "conflict":
      return `${direction} found conflict ${data.conflictId} for ${data.entityType} ${data.entityId}.`
    case "resolved":
      return `${direction} resolved conflict ${data.conflictId} using ${data.resolution}.`
  }
}

const matchesListInput = (
  event: SyncEvent,
  input: z.output<typeof ListSyncEventsInputSchema>
): boolean => {
  if (input.provider !== undefined && event.provider !== input.provider) {
    return false
  }
  if (input.direction !== undefined && event.direction !== input.direction) {
    return false
  }
  if (input.result !== undefined && event.result !== input.result) {
    return false
  }
  if (input.localRecordId !== undefined && event.localRecordId !== input.localRecordId) {
    return false
  }

  return input.remoteRecordId === undefined || event.remoteRecordId === input.remoteRecordId
}

const compareSyncEvents = (left: SyncEvent, right: SyncEvent): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)

const compareCursor = (event: SyncEvent, cursorCreatedAt: string, cursorId: string): number =>
  event.createdAt.localeCompare(cursorCreatedAt) || event.id.localeCompare(cursorId)

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

const validationError = (issues: readonly string[]): ToolResult<never> =>
  ({
    ok: false,
    error: {
      code: "validation_error",
      message: issues[0] ?? "validation failed",
      details: {
        issues,
      },
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
      ...(details === undefined ? {} : { details }),
    },
  }) as ToolResult<never>

const repositoryError = (error: unknown): ToolResult<never> => {
  if (isRepositoryError(error)) {
    return {
      ok: false,
      error: {
        code: mapRepositoryErrorCode(error._tag),
        message: error.message,
        details: {
          repositoryTag: error._tag,
        },
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "Sync event repository operation failed.",
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
): "validation_error" | "malformed_record" | "storage_error" => {
  switch (tag) {
    case "validation_error":
      return "validation_error"
    case "malformed_record":
      return "malformed_record"
    default:
      return "storage_error"
  }
}

const byteLength = (value: string): number => textEncoder.encode(value).length
