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

export type SearchContextEntriesInput = {
  readonly taskId?: string | undefined
  readonly topic?: string | undefined
  readonly query?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type SearchContextEntriesResult = {
  readonly items: readonly ContextEntry[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

type SearchCriteria = {
  readonly taskId?: string | undefined
  readonly topic?: string | undefined
  readonly query?: string | undefined
}

type RankedEntry = {
  readonly entry: ContextEntry
  readonly score: number
}

const textEncoder = new TextEncoder()
const DEFAULT_LIMIT = 20
const MAX_QUERY_BYTES = 2_048
const MAX_SCAN_ENTRIES = 100_000

export const searchContextEntries = (
  input: SearchContextEntriesInput
): Effect.Effect<ToolResult<SearchContextEntriesResult>, never, ContextRepositoryShape> =>
  Effect.gen(function* () {
    const criteria = validateAndNormalizeInput(input)
    if (!criteria.ok) {
      return criteria
    }

    const repo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const loaded = yield* Effect.either(repo.list())
    if (loaded._tag === "Left") {
      return repositoryError(loaded.left)
    }

    const ranked = rankEntries(loaded.right, criteria.data)
    if (!ranked.ok) {
      return ranked
    }

    const afterCursor = sliceAfterCursor(ranked.data, input.cursor)
    if (!afterCursor.ok) {
      return afterCursor
    }

    const limit = normalizeLimit(input.limit)
    const items = afterCursor.data.slice(0, limit)
    const hasMore = afterCursor.data.length > items.length
    if (!hasMore) {
      return {
        ok: true,
        data: {
          items: items.map((rankedEntry) => rankedEntry.entry),
          hasMore: false,
        },
      }
    }

    const last = items[items.length - 1]
    if (last === undefined) {
      return {
        ok: true,
        data: {
          items: [],
          hasMore: false,
        },
      }
    }

    const nextCursor = PageCursor.encode({
      kind: "context.search",
      lastId: last.entry.id,
      lastSort: [last.score, last.entry.updatedAt],
    })
    if (!nextCursor.ok) {
      return nextCursor
    }

    return {
      ok: true,
      data: {
        items: items.map((rankedEntry) => rankedEntry.entry),
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

const validateAndNormalizeInput = (
  input: SearchContextEntriesInput
): ToolResult<SearchCriteria> => {
  const taskId = input.taskId?.trim()
  if (input.taskId !== undefined && taskId?.length === 0) {
    return validationError("taskId must not be empty", { field: "taskId" })
  }

  const topic = input.topic === undefined ? undefined : normalizeTopic(input.topic)
  if (topic !== undefined && !topic.ok) {
    return topic
  }

  const normalizedQuery = normalizeQuery(input.query)
  if (!normalizedQuery.ok) {
    return normalizedQuery
  }

  if (taskId === undefined && topic === undefined && normalizedQuery.data === undefined) {
    return validationError("at least one search criterion is required", {
      fields: ["taskId", "topic", "query"],
    })
  }

  return {
    ok: true,
    data: {
      ...(taskId === undefined ? {} : { taskId }),
      ...(topic === undefined || !topic.ok ? {} : { topic: topic.data }),
      ...(normalizedQuery.data === undefined ? {} : { query: normalizedQuery.data }),
    },
  }
}

const normalizeQuery = (query: string | undefined): ToolResult<string | undefined> => {
  if (query === undefined) {
    return { ok: true, data: undefined }
  }

  if (byteLength(query) > MAX_QUERY_BYTES) {
    return validationError(`query exceeds ${MAX_QUERY_BYTES} bytes`, {
      field: "query",
      maxBytes: MAX_QUERY_BYTES,
    })
  }

  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase()
  if (normalized.length === 0) {
    return validationError("query must not be empty", { field: "query" })
  }

  return {
    ok: true,
    data: normalized,
  }
}

const rankEntries = (
  entries: readonly ContextEntry[],
  criteria: SearchCriteria
): ToolResult<readonly RankedEntry[]> => {
  const ranked: RankedEntry[] = []
  let scanned = 0

  for (const candidate of entries) {
    scanned += 1
    if (scanned > MAX_SCAN_ENTRIES) {
      return {
        ok: false,
        error: {
          code: "storage_error",
          message: `context search scan exceeded ${MAX_SCAN_ENTRIES} entries`,
          details: {
            bound: MAX_SCAN_ENTRIES,
          },
        },
      }
    }

    const parsed = ContextEntrySchema.safeParse(candidate)
    if (!parsed.success) {
      continue
    }

    const score = scoreEntry(parsed.data, criteria)
    if (score === 0) {
      continue
    }

    ranked.push({
      entry: parsed.data,
      score,
    })
  }

  ranked.sort(compareRankedEntries)
  return {
    ok: true,
    data: ranked,
  }
}

const scoreEntry = (entry: ContextEntry, criteria: SearchCriteria): number => {
  const taskMatch =
    criteria.taskId !== undefined &&
    entry.attachedTo.some(
      (attachment) => attachment.kind === "task" && attachment.id === criteria.taskId
    )
  const topicMatch = matchesTopic(entry, criteria.topic)
  const queryMatch = matchesQuery(entry, criteria.query)
  const entityAttachmentMatch = entry.attachedTo.some(
    (attachment) =>
      attachment.kind === "task" || attachment.kind === "story" || attachment.kind === "epic"
  )

  if (taskMatch) {
    return 3
  }

  if (entityAttachmentMatch && (topicMatch || queryMatch)) {
    return 3
  }

  if (topicMatch) {
    return 2
  }

  if (queryMatch) {
    return 1
  }

  return 0
}

const matchesTopic = (entry: ContextEntry, topic: string | undefined): boolean =>
  topic !== undefined &&
  (entry.topics.includes(topic) ||
    entry.attachedTo.some((attachment) => attachment.kind === "topic" && attachment.id === topic))

const matchesQuery = (entry: ContextEntry, query: string | undefined): boolean => {
  if (query === undefined) {
    return false
  }

  return (
    normalizeSearchText(entry.title).includes(query) ||
    normalizeSearchText(entry.body).includes(query)
  )
}

const normalizeSearchText = (value: string): string => value.toLowerCase().replace(/\s+/g, " ")

const compareRankedEntries = (left: RankedEntry, right: RankedEntry): number => {
  if (left.score !== right.score) {
    return right.score - left.score
  }

  if (left.entry.updatedAt !== right.entry.updatedAt) {
    return right.entry.updatedAt.localeCompare(left.entry.updatedAt)
  }

  return left.entry.id.localeCompare(right.entry.id)
}

const sliceAfterCursor = (
  entries: readonly RankedEntry[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly RankedEntry[]> => {
  if (cursor === undefined) {
    return { ok: true, data: entries }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "context.search",
    sortShape: ["number", "string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [score, updatedAt] = decoded.data.lastSort as [number, string]
  return {
    ok: true,
    data: entries.filter(
      (entry) => compareEntryToCursor(entry, score, updatedAt, decoded.data.lastId) > 0
    ),
  }
}

const compareEntryToCursor = (
  entry: RankedEntry,
  score: number,
  updatedAt: string,
  id: string
): number => {
  if (entry.score !== score) {
    return score - entry.score
  }

  if (entry.entry.updatedAt !== updatedAt) {
    return updatedAt.localeCompare(entry.entry.updatedAt)
  }

  return entry.entry.id.localeCompare(id)
}

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(limit, DEFAULT_LIMIT)
}

const byteLength = (value: string): number => textEncoder.encode(value).length

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
