import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Story, StorySchema } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"
import { error, repositoryError } from "./rules.js"
import { type Epic, EpicSchema } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

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

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")
const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const CASCADE_DELETE_LIMIT = 1000

export type CascadeDeleteEpicInput = {
  readonly id: string
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

type CascadeDeleteEpicResult = {
  readonly epic: Epic
}

export const cascadeDeleteEpic = (
  input: CascadeDeleteEpicInput
): Effect.Effect<
  ToolResult<CascadeDeleteEpicResult>,
  never,
  EpicRepositoryShape | StoryRepositoryShape | TaskRepositoryPort | Clock.Clock
> =>
  Effect.gen(function* () {
    const epicRepo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const storyRepo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const taskRepo = (yield* TaskRepository) as unknown as TaskRepositoryShape

    const existing = yield* Effect.either(epicRepo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const stories = yield* collectStories(existing.right.storyIds, storyRepo)
    if (!stories.ok) {
      return stories
    }

    const activeStories = stories.data.filter(isActiveStory)
    if (activeStories.length > 0 && !input.force && !input.cascade) {
      return error("hierarchy_violation", `epic ${input.id} has active stories`, {
        epicId: input.id,
        activeStoryIds: activeStories.map((story) => story.id),
        count: activeStories.length,
      })
    }

    const tasks = yield* collectTasks(activeStories, taskRepo)
    if (!tasks.ok) {
      return tasks
    }

    const activeTasks = tasks.data.filter(isActiveTask)
    const affectedRecords = activeStories.length + activeTasks.length
    if (input.cascade && affectedRecords > CASCADE_DELETE_LIMIT) {
      return error("hierarchy_violation", `epic ${input.id} exceeds the cascade delete limit`, {
        epicId: input.id,
        affectedRecords,
        limit: CASCADE_DELETE_LIMIT,
      })
    }

    const now = yield* nowIso()
    const nextStories = input.cascade
      ? validateStoryTombstones(activeStories, now)
      : ({ ok: true, data: [] } as const)
    if (!nextStories.ok) {
      return nextStories
    }

    const nextTasks = input.cascade
      ? validateTaskTombstones(activeTasks, now)
      : ({ ok: true, data: [] } as const)
    if (!nextTasks.ok) {
      return nextTasks
    }

    const nextEpic = validateEpicTombstone(existing.right, now)
    if (!nextEpic.ok) {
      return nextEpic
    }

    if (input.cascade) {
      for (const task of nextTasks.data) {
        const updated = yield* Effect.either(taskRepo.update(task))
        if (updated._tag === "Left") {
          return repositoryError(updated.left)
        }
      }

      for (const story of nextStories.data) {
        const deleted = yield* Effect.either(storyRepo.tombstone(story.id))
        if (deleted._tag === "Left") {
          return repositoryError(deleted.left)
        }
      }
    }

    const deletedEpic = yield* Effect.either(epicRepo.tombstone(input.id))
    if (deletedEpic._tag === "Left") {
      return repositoryError(deletedEpic.left)
    }

    const parsedEpic = EpicSchema.safeParse(deletedEpic.right)
    if (!parsedEpic.success) {
      return validationError(parsedEpic.error.issues.map((issue) => issue.message))
    }

    return {
      ok: true,
      data: {
        epic: parsedEpic.data,
      },
    }
  })

const collectStories = (
  storyIds: readonly string[],
  storyRepo: StoryRepositoryShape
): Effect.Effect<ToolResult<readonly Story[]>, never> =>
  Effect.gen(function* () {
    const stories: Story[] = []
    for (const storyId of storyIds) {
      const story = yield* Effect.either(storyRepo.get(storyId))
      if (story._tag === "Left") {
        return repositoryError(story.left)
      }

      stories.push(story.right)
    }

    return {
      ok: true,
      data: stories,
    }
  })

const collectTasks = (
  stories: readonly Story[],
  taskRepo: TaskRepositoryShape
): Effect.Effect<ToolResult<readonly Task[]>, never> =>
  Effect.gen(function* () {
    const tasks: Task[] = []
    for (const story of stories) {
      for (const taskId of story.taskIds) {
        const task = yield* Effect.either(taskRepo.findById(taskId))
        if (task._tag === "Left") {
          return repositoryError(task.left)
        }

        tasks.push(task.right)
      }
    }

    return {
      ok: true,
      data: tasks,
    }
  })

const validateStoryTombstones = (
  stories: readonly Story[],
  now: string
): ToolResult<readonly Story[]> => {
  const nextStories: Story[] = []

  for (const story of stories) {
    const parsed = StorySchema.safeParse({
      ...story,
      updatedAt: now,
      deletedAt: now,
    })

    if (!parsed.success) {
      return validationError(parsed.error.issues.map((issue) => issue.message))
    }

    nextStories.push(parsed.data)
  }

  return {
    ok: true,
    data: nextStories,
  }
}

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

const validateEpicTombstone = (epic: Epic, now: string): ToolResult<Epic> => {
  const parsed = EpicSchema.safeParse({
    ...epic,
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

const isActiveStory = (story: Story): boolean =>
  story.deletedAt === undefined && story.status !== "done" && story.status !== "canceled"

const isActiveTask = (task: Task): boolean =>
  task.deletedAt === undefined && task.status !== "done" && task.status !== "canceled"
