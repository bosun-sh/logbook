import { beforeEach, describe, expect, test } from "bun:test"
import { cascadeDeleteEpic } from "@logbook/epic/cascade-delete.js"
import { deleteEpic } from "@logbook/epic/delete.js"
import type { Epic } from "@logbook/epic/schema.js"
import { updateEpic } from "@logbook/epic/update.js"
import type { Story } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

class InMemoryEpicRepository implements EpicRepositoryShape {
  private readonly store = new Map<string, Epic>()

  create(epic: Epic) {
    this.store.set(epic.id, epic)
    return Effect.succeed(epic)
  }

  get(id: string) {
    const epic = this.store.get(id)
    if (epic === undefined || epic.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `epic ${id} was not found`, id })
    }

    return Effect.succeed(epic)
  }

  list() {
    return Effect.succeed([...this.store.values()].filter((epic) => epic.deletedAt === undefined))
  }

  update(epic: Epic) {
    if (!this.store.has(epic.id) || this.store.get(epic.id)?.deletedAt !== undefined) {
      return Effect.fail({
        _tag: "not_found",
        message: `epic ${epic.id} was not found`,
        id: epic.id,
      })
    }

    this.store.set(epic.id, epic)
    return Effect.succeed(epic)
  }

  tombstone(id: string) {
    const epic = this.store.get(id)
    if (epic === undefined || epic.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `epic ${id} was not found`, id })
    }

    const deletedAt = "2026-01-03T09:10:11.123Z"
    const tombstoned = {
      ...epic,
      updatedAt: deletedAt,
      deletedAt,
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }

  inspect() {
    return [...this.store.values()]
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

const EpicRepositoryTag = Context.GenericTag<EpicRepositoryShape>("EpicRepository")
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

const runWithClockAndRepo = <A>(
  effect: Effect.Effect<A, unknown, EpicRepositoryShape | Clock.Clock>,
  repo: InMemoryEpicRepository
) =>
  run(Effect.provide(Effect.withClock(fixedClock)(effect), Layer.succeed(EpicRepositoryTag, repo)))

const makeEpic = (overrides: Partial<Epic> = {}): Epic => ({
  id: "epic_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "epic",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Migration foundation",
  description: "Shared migration work",
  outcome: "Stable v2 base",
  status: "active",
  storyIds: [],
  contextEntryIds: [],
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
  title: "Cascade delete",
  description: "Tombstone descendants",
  definitionOfDone: "Hierarchy delete semantics work",
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

let repo: InMemoryEpicRepository

beforeEach(() => {
  repo = new InMemoryEpicRepository()
})

describe("updateEpic", () => {
  test("updates mutable fields and refreshes updatedAt", async () => {
    const epic = makeEpic()
    await run(repo.create(epic))

    const result = await runWithClockAndRepo(
      updateEpic({
        id: epic.id,
        title: "Updated title",
        description: "Updated description",
        outcome: "Updated outcome",
        status: "paused",
        owner: {
          id: "agent_1",
          title: "Owner",
        },
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected updateEpic to succeed")
    }

    expect(result.data.epic.title).toBe("Updated title")
    expect(result.data.epic.description).toBe("Updated description")
    expect(result.data.epic.outcome).toBe("Updated outcome")
    expect(result.data.epic.status).toBe("paused")
    expect(result.data.epic.owner).toEqual({
      id: "agent_1",
      title: "Owner",
    })
    expect(result.data.epic.updatedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("unknown ids return not_found", async () => {
    const result = await runWithClockAndRepo(
      updateEpic({
        id: "epic_missing",
        title: "Updated title",
      }),
      repo
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "epic_missing" })
    }
  })
})

describe("deleteEpic", () => {
  test("tombstones the epic and preserves identity", async () => {
    const epic = makeEpic({
      id: "epic_00000000000000000000000000000002",
    })
    await run(repo.create(epic))

    const result = await runWithClockAndRepo(deleteEpic({ id: epic.id }), repo)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected deleteEpic to succeed")
    }

    expect(result.data.epic.id).toBe(epic.id)
    expect(result.data.epic.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.epic.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(repo.inspect().find((candidate) => candidate.id === epic.id)?.deletedAt).toBe(
      "2026-01-03T09:10:11.123Z"
    )
  })

  test("unknown ids return not_found", async () => {
    const result = await runWithClockAndRepo(deleteEpic({ id: "epic_missing" }), repo)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "epic_missing" })
    }
  })

  test("cascadeDeleteEpic tombstones active stories and tasks when cascade is explicit", async () => {
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const epic = makeEpic({
      id: "epic_00000000000000000000000000000020",
      storyIds: ["story_00000000000000000000000000000020"],
    })
    const story = makeStory({
      id: "story_00000000000000000000000000000020",
      epicId: epic.id,
      taskIds: ["task_00000000000000000000000000000020"],
      status: "in_progress",
    })
    const task = makeTask({
      id: "task_00000000000000000000000000000020",
      storyId: story.id,
      epicId: epic.id,
      status: "todo",
    })
    await run(repo.create(epic))
    await run(storyRepo.create(story))
    await run(taskRepo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteEpic({ id: epic.id, cascade: true })),
        Layer.mergeAll(
          Layer.succeed(EpicRepositoryTag, repo),
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected cascadeDeleteEpic to succeed")
    }

    expect(result.data.epic.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(storyRepo.inspect(story.id)?.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(taskRepo.inspect(task.id)?.deletedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("cascadeDeleteEpic with force leaves active descendants untouched", async () => {
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const epic = makeEpic({
      id: "epic_00000000000000000000000000000021",
      storyIds: ["story_00000000000000000000000000000021"],
    })
    const story = makeStory({
      id: "story_00000000000000000000000000000021",
      epicId: epic.id,
      taskIds: ["task_00000000000000000000000000000021"],
      status: "ready",
    })
    const task = makeTask({
      id: "task_00000000000000000000000000000021",
      storyId: story.id,
      epicId: epic.id,
      status: "backlog",
    })
    await run(repo.create(epic))
    await run(storyRepo.create(story))
    await run(taskRepo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteEpic({ id: epic.id, force: true })),
        Layer.mergeAll(
          Layer.succeed(EpicRepositoryTag, repo),
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected cascadeDeleteEpic force delete to succeed")
    }

    expect(storyRepo.inspect(story.id)?.deletedAt).toBeUndefined()
    expect(taskRepo.inspect(task.id)?.deletedAt).toBeUndefined()
  })

  test("cascadeDeleteEpic validates story tombstones before writing", async () => {
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const epic = makeEpic({
      id: "epic_00000000000000000000000000000022",
      storyIds: ["story_00000000000000000000000000000022"],
    })
    const invalidStory = makeStory({
      id: "story_00000000000000000000000000000022",
      epicId: "" as never,
      status: "ready",
    })
    await run(repo.create(epic))
    await run(storyRepo.create(invalidStory))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(cascadeDeleteEpic({ id: epic.id, cascade: true })),
        Layer.mergeAll(
          Layer.succeed(EpicRepositoryTag, repo),
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
    expect(storyRepo.tombstoneCalls).toBe(0)
    expect(repo.inspect().find((candidate) => candidate.id === epic.id)?.deletedAt).toBeUndefined()
  })
})
