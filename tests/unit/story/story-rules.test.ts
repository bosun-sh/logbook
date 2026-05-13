import { describe, expect, test } from "bun:test"
import { cascadeDeleteStory } from "@logbook/story/cascade-delete.js"
import { compareStoriesForList, normalizeStoryListLimit } from "@logbook/story/rules.js"
import type { Story } from "@logbook/story/schema.js"
import { attachTaskHierarchy } from "@logbook/task/hierarchy.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Context, Effect, Layer } from "effect"

const makeStory = (overrides: Partial<Story> = {}): Story => ({
  id: "story_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "story",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  epicId: "epic_00000000000000000000000000000001",
  title: "Story foundation",
  description: "Shared story work",
  userValue: "Safer delivery",
  status: "backlog",
  taskIds: [],
  contextEntryIds: [],
  externalLinks: [],
  ...overrides,
})

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-12",
  title: "Attach hierarchy",
  description: "Keep story task ids consistent",
  definitionOfDone: "Hierarchy is enforced",
  status: "backlog",
  priority: 0,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 0,
    complexity: "trivial",
    fibonacci: 1,
    confidence: "low",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

class InMemoryStoryRepository implements StoryRepositoryShape {
  private readonly store = new Map<string, Story>()

  create(story: Story) {
    this.store.set(story.id, story)
    return Effect.succeed(story)
  }

  get(id: string) {
    const story = this.store.get(id)
    if (story === undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    return Effect.succeed(story)
  }

  list() {
    return Effect.succeed([...this.store.values()])
  }

  update(story: Story) {
    this.store.set(story.id, story)
    return Effect.succeed(story)
  }

  tombstone(id: string) {
    const story = this.store.get(id)
    if (story === undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    const tombstoned = { ...story, deletedAt: "2026-01-03T00:00:00.000Z" }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }
}

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

class InMemoryTaskRepository implements TaskRepositoryShape {
  private readonly store = new Map<string, Task>()

  findById(id: string) {
    const task = this.store.get(id)
    if (task === undefined) {
      return Effect.fail({ _tag: "not_found", message: `task ${id} was not found`, id })
    }

    return Effect.succeed(task)
  }

  findByStatus(status: Task["status"] | "*") {
    const tasks = [...this.store.values()]
    return Effect.succeed(status === "*" ? tasks : tasks.filter((task) => task.status === status))
  }

  save(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }
}

const StoryRepositoryTag = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

describe("story rules", () => {
  test("compareStoriesForList orders by updatedAt desc then id asc", () => {
    const newer = makeStory({
      id: "story_00000000000000000000000000000002",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    const older = makeStory({
      id: "story_00000000000000000000000000000003",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const sameTimeLowerId = makeStory({
      id: "story_00000000000000000000000000000001",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    const sameTimeHigherId = makeStory({
      id: "story_00000000000000000000000000000004",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect([older, newer].sort(compareStoriesForList).map((story) => story.id)).toEqual([
      newer.id,
      older.id,
    ])
    expect(
      [sameTimeHigherId, sameTimeLowerId].sort(compareStoriesForList).map((story) => story.id)
    ).toEqual([sameTimeLowerId.id, sameTimeHigherId.id])
  })

  test("normalizeStoryListLimit defaults and clamps the list bound", () => {
    expect(normalizeStoryListLimit(undefined)).toBe(200)
    expect(normalizeStoryListLimit(1)).toBe(1)
    expect(normalizeStoryListLimit(999)).toBe(200)
    expect(normalizeStoryListLimit(0)).toBe(200)
    expect(normalizeStoryListLimit(1.5)).toBe(200)
  })

  test("cascadeDeleteStory blocks implicit deletes when active tasks exist", async () => {
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const story = makeStory({
      taskIds: ["task_00000000000000000000000000000002"],
      status: "in_progress",
    })
    const task = makeTask({
      id: "task_00000000000000000000000000000002",
      storyId: story.id,
      epicId: story.epicId,
      status: "todo",
    })
    await run(storyRepo.create(story))
    await run(taskRepo.save(task))

    const result = await run(
      Effect.provide(
        cascadeDeleteStory({ id: story.id }),
        Layer.merge(
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({
        storyId: story.id,
        activeTaskIds: [task.id],
        count: 1,
      })
    }
  })

  test("cascadeDeleteStory rejects cascades above the 1000-record bound", async () => {
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const taskIds = Array.from(
      { length: 1001 },
      (_, index) => `task_${String(index + 1).padStart(32, "0")}`
    )
    const story = makeStory({ taskIds, status: "ready" })
    await run(storyRepo.create(story))

    for (const taskId of taskIds) {
      await run(
        taskRepo.save(
          makeTask({
            id: taskId,
            storyId: story.id,
            epicId: story.epicId,
            status: "backlog",
          })
        )
      )
    }

    const result = await run(
      Effect.provide(
        cascadeDeleteStory({ id: story.id, cascade: true }),
        Layer.merge(
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({
        storyId: story.id,
        affectedRecords: 1001,
        limit: 1000,
      })
    }
  })

  test("attachTaskHierarchy infers task epicId from the story and appends the task id once", async () => {
    const repo = new InMemoryStoryRepository()
    const story = makeStory({ taskIds: ["task_existing"] })
    await run(repo.create(story))

    const result = await run(
      Effect.provide(
        attachTaskHierarchy(
          makeTask({
            id: "task_00000000000000000000000000000002",
            storyId: story.id,
          })
        ),
        Layer.succeed(StoryRepositoryTag, repo)
      )
    )

    expect(result).toEqual({
      ok: true,
      data: {
        task: {
          ...makeTask({
            id: "task_00000000000000000000000000000002",
            storyId: story.id,
            epicId: story.epicId,
          }),
        },
        story: {
          ...story,
          taskIds: ["task_existing", "task_00000000000000000000000000000002"],
        },
      },
    })
  })

  test("attachTaskHierarchy rejects task epicId disagreement with the story epicId", async () => {
    const repo = new InMemoryStoryRepository()
    const story = makeStory()
    await run(repo.create(story))

    const result = await run(
      Effect.provide(
        attachTaskHierarchy(
          makeTask({
            storyId: story.id,
            epicId: "epic_00000000000000000000000000000099",
          })
        ),
        Layer.succeed(StoryRepositoryTag, repo)
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({
        epicId: "epic_00000000000000000000000000000099",
        storyId: story.id,
        storyEpicId: story.epicId,
      })
    }
  })
})
