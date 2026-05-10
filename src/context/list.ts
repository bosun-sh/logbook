import { type PageCursor as EncodedPageCursor, PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import { type ContextEntry, ContextEntrySchema } from "./schema.js"
import { normalizeTopic } from "./topics.js"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

const ContextRepository = Context.GenericTag<ContextRepositoryShape>("ContextRepository")

export type ListContextEntriesInput = {
  readonly topic?: string | undefined
  readonly attachedTo?:
    | {
        readonly type: "epic" | "story" | "task" | "topic"
        readonly id: string
      }
    | undefined
  readonly includeDeleted?: boolean | undefined
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type ListContextEntriesResult = {
  readonly items: readonly ContextEntry[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

const DEFAULT_LIMIT = 200

export const listContextEntries = (
  input: ListContextEntriesInput
): Effect.Effect<ToolResult<ListContextEntriesResult>, never, ContextRepositoryShape> =>
  Effect.gen(function* () {
    const normalizedTopic = input.topic === undefined ? undefined : normalizeTopic(input.topic)
    if (normalizedTopic !== undefined && !normalizedTopic.ok) {
      return normalizedTopic
    }

    if (input.attachedTo !== undefined && input.attachedTo.id.trim().length === 0) {
      return validationError("attachedTo.id must not be empty", { field: "attachedTo.id" })
    }

    const topicFilter =
      normalizedTopic === undefined || !normalizedTopic.ok ? undefined : normalizedTopic.data

    const repo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const entries =
      input.includeDeleted === true ? yield* loadAllEntries(repo) : yield* loadActiveEntries(repo)
    if (!entries.ok) {
      return entries
    }

    const filtered = entries.data
      .map((entry) => ContextEntrySchema.safeParse(entry))
      .filter((parsed): parsed is { success: true; data: ContextEntry } => parsed.success)
      .map((parsed) => parsed.data)
      .filter((entry) => matchesFilters(entry, input, topicFilter))
      .sort(compareContextEntriesForList)

    const afterCursor = sliceAfterCursor(filtered, input.cursor)
    if (!afterCursor.ok) {
      return afterCursor
    }

    const limit = normalizeListLimit(input.limit)
    const items = afterCursor.data.slice(0, limit)
    const hasMore = afterCursor.data.length > items.length
    if (!hasMore) {
      return {
        ok: true,
        data: {
          items,
          hasMore: false,
        },
      }
    }

    const last = items[items.length - 1]
    if (last === undefined) {
      return {
        ok: true,
        data: {
          items,
          hasMore: false,
        },
      }
    }

    const nextCursor = PageCursor.encode({
      kind: "context.list",
      lastId: last.id,
      lastSort: [last.updatedAt, last.id],
    })
    if (!nextCursor.ok) {
      return nextCursor
    }

    return {
      ok: true,
      data: {
        items,
        hasMore: true,
        nextCursor: nextCursor.data,
      },
      warnings: [
        {
          code: "has_more",
          message: "Additional records are available through a cursor",
          details: {
            cursor: nextCursor.data,
          },
        },
      ],
    }
  })

const loadActiveEntries = (
  repo: ContextRepositoryShape
): Effect.Effect<ToolResult<readonly ContextEntry[]>, never> =>
  Effect.map(Effect.either(repo.list()), (result) =>
    result._tag === "Left" ? repositoryError(result.left) : { ok: true, data: result.right }
  )

const loadAllEntries = (
  repo: ContextRepositoryShape
): Effect.Effect<ToolResult<readonly ContextEntry[]>, never> => {
  if (repo.listAll !== undefined) {
    return Effect.map(Effect.either(repo.listAll()), (result) =>
      result._tag === "Left" ? repositoryError(result.left) : { ok: true, data: result.right }
    )
  }

  return Effect.succeed({
    ok: false,
    error: {
      code: "validation_error",
      message: "includeDeleted requires repository listAll support",
      details: {
        field: "includeDeleted",
        supported: false,
      },
    },
  })
}

const sliceAfterCursor = (
  entries: readonly ContextEntry[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly ContextEntry[]> => {
  if (cursor === undefined) {
    return { ok: true, data: entries }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "context.list",
    sortShape: ["string", "string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [updatedAt, id] = decoded.data.lastSort as [string, string]
  return {
    ok: true,
    data: entries.filter((entry) => compareEntryToCursor(entry, updatedAt, id) > 0),
  }
}

const compareContextEntriesForList = (left: ContextEntry, right: ContextEntry): number => {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }

  return left.id.localeCompare(right.id)
}

const compareEntryToCursor = (entry: ContextEntry, updatedAt: string, id: string): number => {
  if (entry.updatedAt !== updatedAt) {
    return updatedAt.localeCompare(entry.updatedAt)
  }

  return entry.id.localeCompare(id)
}

const matchesFilters = (
  entry: ContextEntry,
  input: ListContextEntriesInput,
  topic: string | undefined
): boolean => {
  const topicMatch = topic === undefined || entry.topics.includes(topic)
  const attachmentMatch =
    input.attachedTo === undefined ||
    entry.attachedTo.some(
      (attachment) =>
        attachment.kind === input.attachedTo?.type && attachment.id === input.attachedTo.id
    )

  return topicMatch && attachmentMatch
}

const normalizeListLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(limit, DEFAULT_LIMIT)
}

const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )
    const id = typeof tagged.id === "string" ? tagged.id : undefined

    return {
      ok: false,
      error: {
        code: String(tagged._tag),
        message:
          typeof tagged.message === "string" ? tagged.message : "repository operation failed",
        ...(id === undefined || Object.hasOwn(details, "id")
          ? { details }
          : { details: { ...details, id } }),
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "repository operation failed",
    },
  }
}
