import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"
import { error, repositoryError } from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const CASCADE_DELETE_LIMIT = 1000

export type CascadeDeleteStoryInput = {
  readonly id: string
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

type CascadeDeleteStoryResult = {
  readonly story: Story
}

export const cascadeDeleteStory = (
  input: CascadeDeleteStoryInput
): Effect.Effect<
  ToolResult<CascadeDeleteStoryResult>,
  never,
  StoryRepositoryShape | TaskRepositoryPort | Clock.Clock
> =>
  Effect.gen(function* () {
    const storyRepo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const taskRepo = (yield* TaskRepository) as unknown as TaskRepositoryShape

    const existing = yield* Effect.either(storyRepo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const tasks = yield* collectTasks(existing.right.taskIds, taskRepo)
    if (!tasks.ok) {
      return tasks
    }

    const activeTasks = tasks.data.filter(isActiveTask)
    if (activeTasks.length > 0 && !input.force && !input.cascade) {
      return error("hierarchy_violation", `story ${input.id} has active tasks`, {
        storyId: input.id,
        activeTaskIds: activeTasks.map((task) => task.id),
        count: activeTasks.length,
      })
    }

    if (input.cascade && activeTasks.length > CASCADE_DELETE_LIMIT) {
      return error("hierarchy_violation", `story ${input.id} exceeds the cascade delete limit`, {
        storyId: input.id,
        affectedRecords: activeTasks.length,
        limit: CASCADE_DELETE_LIMIT,
      })
    }

    const now = yield* nowIso()
    const nextTasks = input.cascade
      ? validateTaskTombstones(activeTasks, now)
      : { ok: true as const, data: [] as readonly Task[] }
    if (!nextTasks.ok) {
      return nextTasks
    }

    const nextStory = validateStoryTombstone(existing.right, now)
    if (!nextStory.ok) {
      return nextStory
    }

    if (input.cascade) {
      for (const task of nextTasks.data) {
        const updated = yield* Effect.either(taskRepo.update(task))
        if (updated._tag === "Left") {
          return repositoryError(updated.left)
        }
      }
    }

    const deleted = yield* Effect.either(storyRepo.tombstone(input.id))
    if (deleted._tag === "Left") {
      return repositoryError(deleted.left)
    }

    const parsed = StorySchema.safeParse(deleted.right)
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((issue) => issue.message))
    }

    return {
      ok: true,
      data: {
        story: parsed.data,
      },
    }
  })

const collectTasks = (
  taskIds: readonly string[],
  taskRepo: TaskRepositoryShape
): Effect.Effect<ToolResult<readonly Task[]>, never> =>
  Effect.gen(function* () {
    const tasks: Task[] = []
    for (const taskId of taskIds) {
      const task = yield* Effect.either(taskRepo.findById(taskId))
      if (task._tag === "Left") {
        return repositoryError(task.left)
      }

      tasks.push(task.right)
    }

    return {
      ok: true,
      data: tasks,
    }
  })

const validateTaskTombstones = (
  tasks: readonly Task[],
  now: string
): ToolResult<readonly Task[]> => {
  const nextTasks: Task[] = []

  for (const task of tasks) {
    const parsed = TaskSchema.safeParse({
      ...task,
      updatedAt: now,
      deletedAt: now,
    })

    if (!parsed.success) {
      return validationError(parsed.error.issues.map((issue) => issue.message))
    }

    nextTasks.push(parsed.data)
  }

  return {
    ok: true,
    data: nextTasks,
  }
}

const validateStoryTombstone = (story: Story, now: string): ToolResult<Story> => {
  const parsed = StorySchema.safeParse({
    ...story,
    updatedAt: now,
    deletedAt: now,
  })

  if (!parsed.success) {
    return validationError(parsed.error.issues.map((issue) => issue.message))
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

const validationError = (issues: readonly string[]): ToolResult<never> =>
  error("validation_error", issues[0] ?? "validation failed", { issues })

const isActiveTask = (task: Task): boolean =>
  task.deletedAt === undefined && task.status !== "done" && task.status !== "canceled"
