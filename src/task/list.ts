import { type PageCursor as EncodedPageCursor, PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Effect } from "effect"
import { error } from "./comments.js"
import { compareTasksForList } from "./ordering.js"
import { TaskRepository } from "./ports.js"
import type { Task } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 200

export type ListTasksInput = {
  readonly status?: Task["status"] | "*"
  readonly project?: string | undefined
  readonly milestone?: string | undefined
  readonly epicId?: string | undefined
  readonly storyId?: string | undefined
  readonly assigneeId?: string | undefined
  readonly sessionId?: string | undefined
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type ListTasksResult = {
  readonly items: readonly Task[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

export const listTasks = (
  input: ListTasksInput
): Effect.Effect<ToolResult<ListTasksResult>, never, TaskRepository> =>
  Effect.gen(function* () {
    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const tasks = yield* Effect.either(repo.findByStatus(input.status ?? "*"))
    if (tasks._tag === "Left") {
      return repositoryError(tasks.left)
    }

    const filtered = tasks.right
      .filter((task) => matchesFilters(task, input))
      .sort(compareTasksForList)
    const afterCursor = sliceAfterCursor(filtered, input.cursor)
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
      kind: "task.list",
      lastId: last.id,
      lastSort: [last.priority, last.updatedAt],
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
          details: { cursor: nextCursor.data },
        },
      ],
    }
  })

const matchesFilters = (task: Task, input: ListTasksInput): boolean =>
  (input.project === undefined || task.project === input.project) &&
  (input.milestone === undefined || task.milestone === input.milestone) &&
  (input.epicId === undefined || task.epicId === input.epicId) &&
  (input.storyId === undefined || task.storyId === input.storyId) &&
  (input.assigneeId === undefined || task.assignee?.id === input.assigneeId) &&
  (input.sessionId === undefined || task.sessionId === input.sessionId)

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(limit, MAX_LIMIT)
}

const sliceAfterCursor = (
  tasks: readonly Task[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly Task[]> => {
  if (cursor === undefined) {
    return { ok: true, data: tasks }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "task.list",
    sortShape: ["number", "string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [priority, updatedAt] = decoded.data.lastSort as [number, string]
  return {
    ok: true,
    data: tasks.filter(
      (task) => compareTaskToCursor(task, priority, updatedAt, decoded.data.lastId) > 0
    ),
  }
}

const compareTaskToCursor = (
  task: Task,
  priority: number,
  updatedAt: string,
  id: string
): number => {
  if (task.priority !== priority) {
    return priority - task.priority
  }

  if (task.updatedAt !== updatedAt) {
    return updatedAt.localeCompare(task.updatedAt)
  }

  return task.id.localeCompare(id)
}

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )
    return error(
      String(tagged._tag),
      typeof tagged.message === "string" ? tagged.message : "repository operation failed",
      Object.keys(details).length === 0 ? undefined : details
    )
  }

  return error("storage_error", "repository operation failed")
}
