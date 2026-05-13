import { type PageCursor as EncodedPageCursor, PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import {
  compareStoriesForList,
  matchesStoryListFilters,
  normalizeStoryListLimit,
  repositoryError,
} from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

export type ListStoriesInput = {
  readonly epicId?: string | undefined
  readonly status?: Story["status"] | undefined
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type ListStoriesResult = {
  readonly items: readonly Story[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

export const listStories = (
  input: ListStoriesInput
): Effect.Effect<ToolResult<ListStoriesResult>, never, StoryRepositoryShape> =>
  Effect.gen(function* () {
    if (input.epicId !== undefined && input.epicId.length === 0) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "epicId must not be empty",
          details: { field: "epicId" },
        },
      }
    }

    if (input.status !== undefined && !isStoryStatus(input.status)) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "status must be a valid story status",
          details: { field: "status" },
        },
      }
    }

    const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const stories = yield* Effect.either(repo.list())
    if (stories._tag === "Left") {
      return repositoryError(stories.left)
    }

    const filtered = stories.right
      .map((story) => StorySchema.safeParse(story))
      .filter((parsed): parsed is { success: true; data: Story } => parsed.success)
      .map((parsed) => parsed.data)
      .filter((story) =>
        matchesStoryListFilters(story, { epicId: input.epicId, status: input.status })
      )
      .sort(compareStoriesForList)
    const afterCursor = sliceAfterCursor(filtered, input.cursor)
    if (!afterCursor.ok) {
      return afterCursor
    }

    const limit = normalizeStoryListLimit(input.limit)
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
      kind: "story.list",
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
  stories: readonly Story[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly Story[]> => {
  if (cursor === undefined) {
    return { ok: true, data: stories }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "story.list",
    sortShape: ["string", "string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [updatedAt, id] = decoded.data.lastSort as [string, string]
  return {
    ok: true,
    data: stories.filter((story) => compareStoryToCursor(story, updatedAt, id) > 0),
  }
}

const compareStoryToCursor = (story: Story, updatedAt: string, id: string): number => {
  if (story.updatedAt !== updatedAt) {
    return updatedAt.localeCompare(story.updatedAt)
  }

  return story.id.localeCompare(id)
}

const isStoryStatus = (value: unknown): value is Story["status"] =>
  value === "backlog" ||
  value === "ready" ||
  value === "in_progress" ||
  value === "done" ||
  value === "canceled"
