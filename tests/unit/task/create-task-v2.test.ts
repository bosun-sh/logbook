import { describe, expect, test } from "bun:test"
import type { Story } from "@logbook/story/schema.js"
import { createTask } from "@logbook/task/create.js"
import { getTask } from "@logbook/task/get.js"
import { listTasks } from "@logbook/task/list.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

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
    const story = this.store.get(id)
    if (story === undefined || story.deletedAt === undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    return Effect.succeed(story)
  }

  inspect(id: string) {
    return this.store.get(id)
  }
}

const StoryRepositoryTag = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-02T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-02T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const makeLayer = (repo: InMemoryTaskRepository) =>
  Layer.succeed(TaskRepository, repo as unknown as TaskRepositoryPort)

const makeLayerWithStoryRepo = (
  taskRepo: InMemoryTaskRepository,
  storyRepo: InMemoryStoryRepository
) =>
  Layer.mergeAll(
    Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort),
    Layer.succeed(StoryRepositoryTag, storyRepo)
  )

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-07",
  title: "Implement task CRUD",
  description: "Adapter-free use cases",
  definitionOfDone: "Task CRUD works",
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
  taskIds: ["task_existing"],
  contextEntryIds: [],
  externalLinks: [],
  ...overrides,
})

describe("task v2 create/get/list use cases", () => {
  test("createTask persists a backlog task with default priority 0", async () => {
    const repo = new InMemoryTaskRepository()
    const storyRepo = new InMemoryStoryRepository()
    const layer = makeLayerWithStoryRepo(repo, storyRepo)

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          createTask({
            title: "Implement task CRUD use cases",
            description: "Wire create/get/list/update/edit over the task repository",
            definitionOfDone: "Task CRUD use cases pass focused tests",
            project: "migration",
            milestone: "task-07",
          })
        ),
        layer
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected task creation to succeed")
    }

    expect(result.data.task.status).toBe("backlog")
    expect(result.data.task.priority).toBe(0)
    expect(result.data.task.createdAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.task.updatedAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.task.id.startsWith("task_")).toBe(true)

    const fetched = await run(Effect.provide(getTask({ id: result.data.task.id }), layer))
    expect(fetched).toEqual({
      ok: true,
      data: {
        task: result.data.task,
      },
    })
  })

  test("getTask returns a structured not_found error for unknown ids", async () => {
    const result = await run(
      Effect.provide(getTask({ id: "task_missing" }), makeLayer(new InMemoryTaskRepository()))
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "task_missing" })
    }
  })

  test("listTasks orders by priority desc, updatedAt desc, id asc and paginates at 200", async () => {
    const repo = new InMemoryTaskRepository()
    const layer = makeLayer(repo)

    await run(
      Effect.provide(
        Effect.all([
          repo.save(
            makeTask({
              id: "task_00000000000000000000000000000003",
              title: "third by id",
              priority: 5,
              updatedAt: "2026-01-04T00:00:00.000Z",
            })
          ),
          repo.save(
            makeTask({
              id: "task_00000000000000000000000000000002",
              title: "first by id",
              priority: 5,
              updatedAt: "2026-01-04T00:00:00.000Z",
            })
          ),
          repo.save(
            makeTask({
              id: "task_00000000000000000000000000000004",
              title: "older high priority",
              priority: 5,
              updatedAt: "2026-01-03T00:00:00.000Z",
            })
          ),
          ...Array.from({ length: 199 }, (_, index) =>
            repo.save(
              makeTask({
                id: `task_${String(index + 10).padStart(32, "0")}`,
                title: `task ${index}`,
                priority: 0,
                updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
              })
            )
          ),
        ]),
        layer
      )
    )

    const firstPage = await run(Effect.provide(listTasks({ status: "*" }), layer))
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected first page to succeed")
    }

    expect(firstPage.data.items).toHaveLength(200)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.items.slice(0, 3).map((task) => task.id)).toEqual([
      "task_00000000000000000000000000000002",
      "task_00000000000000000000000000000003",
      "task_00000000000000000000000000000004",
    ])
    expect(firstPage.warnings).toEqual([
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: {
          cursor: expect.any(String),
        },
      },
    ])

    const secondPage = await run(
      Effect.provide(listTasks({ status: "*", cursor: firstPage.data.nextCursor }), layer)
    )

    expect(secondPage).toEqual({
      ok: true,
      data: {
        items: expect.any(Array),
        hasMore: false,
        nextCursor: undefined,
      },
    })

    if (secondPage.ok) {
      expect(secondPage.data.items).toHaveLength(2)
    }
  })

  test("listTasks rejects malformed cursors with validation_error", async () => {
    const repo = new InMemoryTaskRepository()
    await run(repo.save(makeTask()))

    const result = await run(
      Effect.provide(listTasks({ status: "*", cursor: "not a cursor?" }), makeLayer(repo))
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
  })

  test("createTask attaches story hierarchy, infers epicId, and appends the task id once", async () => {
    const repo = new InMemoryTaskRepository()
    const storyRepo = new InMemoryStoryRepository()
    const story = makeStory()
    await run(storyRepo.create(story))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          createTask({
            title: "Implement hierarchy checks",
            description: "Validate task parent story before writes",
            definitionOfDone: "Task hierarchy tests pass",
            project: "migration",
            milestone: "task-12",
            storyId: story.id,
          })
        ),
        makeLayerWithStoryRepo(repo, storyRepo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected task creation to succeed")
    }

    expect(result.data.task.storyId).toBe(story.id)
    expect(result.data.task.epicId).toBe(story.epicId)

    const updatedStory = storyRepo.inspect(story.id)
    expect(updatedStory).toBeDefined()
    expect(updatedStory?.taskIds).toEqual(["task_existing", result.data.task.id])
    expect(new Set(updatedStory!.taskIds).size).toBe(updatedStory!.taskIds.length)
  })

  test("createTask rejects epic disagreement with the parent story before saving", async () => {
    const repo = new InMemoryTaskRepository()
    const storyRepo = new InMemoryStoryRepository()
    const story = makeStory()
    await run(storyRepo.create(story))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          createTask({
            title: "Implement hierarchy checks",
            description: "Validate task parent story before writes",
            definitionOfDone: "Task hierarchy tests pass",
            project: "migration",
            milestone: "task-12",
            storyId: story.id,
            epicId: "epic_00000000000000000000000000000099",
          })
        ),
        makeLayerWithStoryRepo(repo, storyRepo)
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

    const tasks = await run(Effect.provide(listTasks({ status: "*" }), makeLayer(repo)))
    expect(tasks.ok).toBe(true)
    if (tasks.ok) {
      expect(tasks.data.items).toEqual([])
    }
    expect(storyRepo.inspect(story.id)?.taskIds).toEqual(["task_existing"])
  })

  test("createTask rejects hierarchy updates over the story task bound", async () => {
    const repo = new InMemoryTaskRepository()
    const storyRepo = new InMemoryStoryRepository()
    const story = makeStory({
      taskIds: Array.from(
        { length: 1000 },
        (_, index) => `task_${String(index).padStart(32, "0")}`
      ),
    })
    await run(storyRepo.create(story))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          createTask({
            title: "Implement hierarchy checks",
            description: "Validate task parent story before writes",
            definitionOfDone: "Task hierarchy tests pass",
            project: "migration",
            milestone: "task-12",
            storyId: story.id,
          })
        ),
        makeLayerWithStoryRepo(repo, storyRepo)
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({ storyId: story.id, limit: 1000 })
    }

    const tasks = await run(Effect.provide(listTasks({ status: "*" }), makeLayer(repo)))
    expect(tasks.ok).toBe(true)
    if (tasks.ok) {
      expect(tasks.data.items).toEqual([])
    }
    expect(storyRepo.inspect(story.id)?.taskIds).toHaveLength(1000)
  })
})
