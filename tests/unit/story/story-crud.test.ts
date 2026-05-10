import { beforeEach, describe, expect, test } from "bun:test"
import { cascadeDeleteStory } from "@logbook/story/cascade-delete.js"
import { deleteStory } from "@logbook/story/delete.js"
import { getStory } from "@logbook/story/get.js"
import { listStories } from "@logbook/story/list.js"
import type { Story } from "@logbook/story/schema.js"
import { updateStory } from "@logbook/story/update.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

class InMemoryStoryRepository implements StoryRepositoryShape {
  private readonly store = new Map<string, Story>()
  tombstoneCalls = 0

  create(story: Story) {
    this.store.set(story.id, story)
    return Effect.succeed(story)
  }

  get(id: string) {
    const story = this.store.get(id)
    if (story === undefined || story.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    return Effect.succeed(story)
  }

  list() {
    return Effect.succeed([...this.store.values()].filter((story) => story.deletedAt === undefined))
  }

  update(story: Story) {
    if (!this.store.has(story.id) || this.store.get(story.id)?.deletedAt !== undefined) {
      return Effect.fail({
        _tag: "not_found",
        message: `story ${story.id} was not found`,
        id: story.id,
      })
    }

    this.store.set(story.id, story)
    return Effect.succeed(story)
  }

  tombstone(id: string) {
    this.tombstoneCalls += 1
    const story = this.store.get(id)
    if (story === undefined || story.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    const deletedAt = "2026-01-03T09:10:11.123Z"
    const tombstoned = {
      ...story,
      updatedAt: deletedAt,
      deletedAt,
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }

  inspect(id: string) {
    return this.store.get(id)
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
  updateCalls = 0

  findById(id: string) {
    const task = this.store.get(id)
    if (task === undefined || task.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `task ${id} was not found`, id })
    }

    return Effect.succeed(task)
  }

  findByStatus(status: Task["status"] | "*") {
    const tasks = [...this.store.values()].filter((task) => task.deletedAt === undefined)
    return Effect.succeed(status === "*" ? tasks : tasks.filter((task) => task.status === status))
  }

  save(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task) {
    this.updateCalls += 1
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  inspect(id: string) {
    return this.store.get(id)
  }
}

const StoryRepositoryTag = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-03T09:10:11.123Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-03T09:10:11.123Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const runWithStoryRepo = <A>(effect: Effect.Effect<A, unknown, StoryRepositoryShape>) =>
  run(Effect.provide(effect, Layer.succeed(StoryRepositoryTag, storyRepo)))

const runWithClockAndStoryRepo = <A>(
  effect: Effect.Effect<A, unknown, StoryRepositoryShape | Clock.Clock>
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.succeed(StoryRepositoryTag, storyRepo)
    )
  )

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
  status: "ready",
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
  milestone: "task-13",
  title: "Delete child task",
  description: "Cascade story delete",
  definitionOfDone: "Story delete semantics hold",
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

let storyRepo: InMemoryStoryRepository

beforeEach(() => {
  storyRepo = new InMemoryStoryRepository()
})

describe("getStory", () => {
  test("returns not_found for unknown ids", async () => {
    const result = await runWithStoryRepo(getStory({ id: "story_missing" }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "story_missing" })
    }
  })
})

describe("listStories", () => {
  test("orders deterministically, filters, and paginates with a cursor", async () => {
    const ordered = Array.from({ length: 201 }, (_, index) =>
      makeStory({
        id: `story_${String(index + 1).padStart(32, "0")}`,
        title: `Story ${index + 1}`,
        epicId:
          index % 2 === 0
            ? "epic_00000000000000000000000000000001"
            : "epic_00000000000000000000000000000002",
        status: index % 2 === 0 ? "ready" : "backlog",
        createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        updatedAt: `2026-01-02T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      })
    )

    for (const story of ordered) {
      await run(storyRepo.create(story))
    }

    const filtered = await runWithStoryRepo(
      listStories({
        epicId: "epic_00000000000000000000000000000001",
        status: "ready",
      })
    )
    expect(filtered.ok).toBe(true)
    if (!filtered.ok) {
      throw new Error("expected listStories to succeed")
    }

    expect(
      filtered.data.items.every(
        (story) =>
          story.epicId === "epic_00000000000000000000000000000001" && story.status === "ready"
      )
    ).toBe(true)

    const firstPage = await runWithStoryRepo(listStories({}))
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected first page to succeed")
    }

    expect(firstPage.data.items).toHaveLength(200)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.nextCursor).toBeDefined()
    expect(firstPage.warnings).toEqual([
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: {
          cursor: firstPage.data.nextCursor,
        },
      },
    ])

    const secondPage = await runWithStoryRepo(
      listStories({
        cursor: firstPage.data.nextCursor,
      })
    )
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) {
      throw new Error("expected second page to succeed")
    }

    expect(secondPage.data.items).toHaveLength(1)
    expect(secondPage.data.hasMore).toBe(false)
  })
})

describe("updateStory", () => {
  test("updates mutable fields and refreshes updatedAt", async () => {
    const story = makeStory()
    await run(storyRepo.create(story))

    const result = await runWithClockAndStoryRepo(
      updateStory({
        id: story.id,
        title: "Updated title",
        description: "Updated description",
        userValue: "Updated user value",
        status: "in_progress",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected updateStory to succeed")
    }

    expect(result.data.story.title).toBe("Updated title")
    expect(result.data.story.description).toBe("Updated description")
    expect(result.data.story.userValue).toBe("Updated user value")
    expect(result.data.story.status).toBe("in_progress")
    expect(result.data.story.updatedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("unknown ids return not_found", async () => {
    const result = await runWithClockAndStoryRepo(
      updateStory({
        id: "story_missing",
        title: "Updated title",
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "story_missing" })
    }
  })
})

describe("deleteStory", () => {
  test("tombstones the story and preserves identity", async () => {
    const story = makeStory({
      id: "story_00000000000000000000000000000002",
    })
    await run(storyRepo.create(story))

    const result = await runWithClockAndStoryRepo(deleteStory({ id: story.id }))

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected deleteStory to succeed")
    }

    expect(result.data.story.id).toBe(story.id)
    expect(result.data.story.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.story.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(storyRepo.inspect(story.id)?.deletedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("unknown ids return not_found", async () => {
    const result = await runWithClockAndStoryRepo(deleteStory({ id: "story_missing" }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "story_missing" })
    }
  })

  test("cascadeDeleteStory tombstones active tasks when cascade is explicit", async () => {
    const taskRepo = new InMemoryTaskRepository()
    const story = makeStory({
      id: "story_00000000000000000000000000000020",
      taskIds: ["task_00000000000000000000000000000020"],
      status: "in_progress",
    })
    const task = makeTask({
      id: "task_00000000000000000000000000000020",
      storyId: story.id,
      epicId: story.epicId,
      status: "todo",
    })
    await run(storyRepo.create(story))
    await run(taskRepo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteStory({ id: story.id, cascade: true })),
        Layer.merge(
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected cascadeDeleteStory to succeed")
    }

    expect(result.data.story.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(taskRepo.inspect(task.id)?.deletedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("cascadeDeleteStory with force leaves active tasks untouched", async () => {
    const taskRepo = new InMemoryTaskRepository()
    const story = makeStory({
      id: "story_00000000000000000000000000000021",
      taskIds: ["task_00000000000000000000000000000021"],
      status: "ready",
    })
    const task = makeTask({
      id: "task_00000000000000000000000000000021",
      storyId: story.id,
      epicId: story.epicId,
      status: "backlog",
    })
    await run(storyRepo.create(story))
    await run(taskRepo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteStory({ id: story.id, force: true })),
        Layer.merge(
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected cascadeDeleteStory force delete to succeed")
    }

    expect(taskRepo.inspect(task.id)?.deletedAt).toBeUndefined()
  })

  test("cascadeDeleteStory validates task tombstones before writing", async () => {
    const taskRepo = new InMemoryTaskRepository()
    const story = makeStory({
      id: "story_00000000000000000000000000000022",
      taskIds: ["task_00000000000000000000000000000022"],
      status: "ready",
    })
    const invalidTask = makeTask({
      id: "task_00000000000000000000000000000022",
      storyId: story.id,
      epicId: story.epicId,
      project: "" as never,
      status: "backlog",
    })
    await run(storyRepo.create(story))
    await run(taskRepo.save(invalidTask))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteStory({ id: story.id, cascade: true })),
        Layer.merge(
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
    expect(taskRepo.updateCalls).toBe(0)
    expect(storyRepo.tombstoneCalls).toBe(0)
    expect(storyRepo.inspect(story.id)?.deletedAt).toBeUndefined()
  })
})
