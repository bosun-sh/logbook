import { type PageCursor as EncodedPageCursor, PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import {
  compareEpicsForList,
  matchesEpicListFilters,
  normalizeEpicListLimit,
  repositoryError,
} from "./rules.js"
import type { Epic } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type ListEpicsInput = {
  readonly status?: Epic["status"] | undefined
  readonly ownerId?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type ListEpicsResult = {
  readonly items: readonly Epic[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

export const listEpics = (
  input: ListEpicsInput
): Effect.Effect<ToolResult<ListEpicsResult>, never, EpicRepositoryShape> =>
  Effect.gen(function* () {
    if (input.status !== undefined && !isEpicStatus(input.status)) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "status must be a valid epic status",
          details: { field: "status" },
        },
      }
    }

    if (input.ownerId !== undefined && input.ownerId.length === 0) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "ownerId must not be empty",
          details: { field: "ownerId" },
        },
      }
    }

    const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const epics = yield* Effect.either(repo.list())
    if (epics._tag === "Left") {
      return repositoryError(epics.left)
    }

    const filtered = epics.right
      .filter((epic) =>
        matchesEpicListFilters(epic, { status: input.status, ownerId: input.ownerId })
      )
      .sort(compareEpicsForList)
    const afterCursor = sliceAfterCursor(filtered, input.cursor)
    if (!afterCursor.ok) {
      return afterCursor
    }

    const limit = normalizeEpicListLimit(input.limit)
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
      kind: "epic.list",
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

const sliceAfterCursor = (
  epics: readonly Epic[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly Epic[]> => {
  if (cursor === undefined) {
    return { ok: true, data: epics }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "epic.list",
    sortShape: ["string", "string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [updatedAt, id] = decoded.data.lastSort as [string, string]
  return {
    ok: true,
    data: epics.filter((epic) => compareEpicToCursor(epic, updatedAt, id) > 0),
  }
}

const compareEpicToCursor = (epic: Epic, updatedAt: string, id: string): number => {
  if (epic.updatedAt !== updatedAt) {
    return updatedAt.localeCompare(epic.updatedAt)
  }

  return epic.id.localeCompare(id)
}

const isEpicStatus = (value: unknown): value is Epic["status"] =>
  value === "backlog" ||
  value === "active" ||
  value === "paused" ||
  value === "done" ||
  value === "canceled"
