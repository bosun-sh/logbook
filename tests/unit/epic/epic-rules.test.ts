import { describe, expect, test } from "bun:test"
import { cascadeDeleteEpic } from "@logbook/epic/cascade-delete.js"
import { compareEpicsForList, normalizeEpicListLimit } from "@logbook/epic/rules.js"
import type { Epic } from "@logbook/epic/schema.js"
import { validateHierarchyLink } from "@logbook/story/hierarchy.js"
import type { Story } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Context, Effect, Layer } from "effect"

const makeEpic = (overrides: Partial<Epic> = {}): Epic => ({
  id: "epic_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "epic",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Migration foundation",
  description: "Shared migration work",
  outcome: "Stable v2 base",
  status: "backlog",
  storyIds: [],
  contextEntryIds: [],
  externalLinks: [],
  ...overrides,
})

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
    if (epic === undefined) {
      return Effect.fail({ _tag: "not_found", message: `epic ${id} was not found`, id })
    }

    return Effect.succeed(epic)
  }

  list() {
    return Effect.succeed([...this.store.values()])
  }

  update(epic: Epic) {
    this.store.set(epic.id, epic)
    return Effect.succeed(epic)
  }

  tombstone(id: string) {
    const epic = this.store.get(id)
    if (epic === undefined) {
      return Effect.fail({ _tag: "not_found", message: `epic ${id} was not found`, id })
    }

    const tombstoned = { ...epic, deletedAt: "2026-01-03T00:00:00.000Z" }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
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

const EpicRepositoryTag = Context.GenericTag<EpicRepositoryShape>("EpicRepository")
const StoryRepositoryTag = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

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
  title: "Delete descendants",
  description: "Cascade through hierarchy",
  definitionOfDone: "Cascade delete works",
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

describe("epic rules", () => {
  test("compareEpicsForList orders by updatedAt desc then id asc", () => {
    const newer = makeEpic({
      id: "epic_00000000000000000000000000000002",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    const older = makeEpic({
      id: "epic_00000000000000000000000000000003",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const sameTimeLowerId = makeEpic({
      id: "epic_00000000000000000000000000000001",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    const sameTimeHigherId = makeEpic({
      id: "epic_00000000000000000000000000000004",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect([older, newer].sort(compareEpicsForList).map((epic) => epic.id)).toEqual([
      newer.id,
      older.id,
    ])
    expect(
      [sameTimeHigherId, sameTimeLowerId].sort(compareEpicsForList).map((epic) => epic.id)
    ).toEqual([sameTimeLowerId.id, sameTimeHigherId.id])
  })

  test("normalizeEpicListLimit defaults and clamps the list bound", () => {
    expect(normalizeEpicListLimit(undefined)).toBe(200)
    expect(normalizeEpicListLimit(1)).toBe(1)
    expect(normalizeEpicListLimit(999)).toBe(200)
    expect(normalizeEpicListLimit(0)).toBe(200)
    expect(normalizeEpicListLimit(1.5)).toBe(200)
  })

  test("validateHierarchyLink appends a story id once to an active epic", async () => {
    const repo = new InMemoryEpicRepository()
    const epic = makeEpic({ storyIds: ["story_existing"] })
    await run(repo.create(epic))

    const result = await run(
      Effect.provide(
        validateHierarchyLink({
          epicId: epic.id,
          storyId: "story_00000000000000000000000000000002",
        }),
        Layer.succeed(EpicRepositoryTag, repo)
      )
    )

    expect(result).toEqual({
      ok: true,
      data: {
        epic: {
          ...epic,
          storyIds: ["story_existing", "story_00000000000000000000000000000002"],
        },
      },
    })
  })

  test("validateHierarchyLink rejects story reference updates over 1000", async () => {
    const repo = new InMemoryEpicRepository()
    const epic = makeEpic({
      storyIds: Array.from(
        { length: 1000 },
        (_, index) => `story_${String(index).padStart(32, "0")}`
      ),
    })
    await run(repo.create(epic))

    const result = await run(
      Effect.provide(
        validateHierarchyLink({
          epicId: epic.id,
          storyId: "story_00000000000000000000000000001001",
        }),
        Layer.succeed(EpicRepositoryTag, repo)
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({ epicId: epic.id, limit: 1000 })
    }
  })

  test("cascadeDeleteEpic blocks implicit deletes when active stories exist", async () => {
    const epicRepo = new InMemoryEpicRepository()
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const epic = makeEpic({ storyIds: ["story_00000000000000000000000000000002"] })
    const story = makeStory({
      id: "story_00000000000000000000000000000002",
      epicId: epic.id,
      status: "in_progress",
    })
    await run(epicRepo.create(epic))
    await run(storyRepo.create(story))
    await run(taskRepo.save(makeTask()))

    const result = await run(
      Effect.provide(
        cascadeDeleteEpic({ id: epic.id }),
        Layer.mergeAll(
          Layer.succeed(EpicRepositoryTag, epicRepo),
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({
        epicId: epic.id,
        activeStoryIds: [story.id],
        count: 1,
      })
    }
  })

  test("cascadeDeleteEpic rejects cascades above the 1000-record bound", async () => {
    const epicRepo = new InMemoryEpicRepository()
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()
    const storyIds = Array.from(
      { length: 1001 },
      (_, index) => `story_${String(index + 1).padStart(32, "0")}`
    )
    const epic = makeEpic({ storyIds })
    await run(epicRepo.create(epic))

    for (const storyId of storyIds) {
      await run(
        storyRepo.create(
          makeStory({
            id: storyId,
            epicId: epic.id,
            status: "ready",
          })
        )
      )
    }

    const result = await run(
      Effect.provide(
        cascadeDeleteEpic({ id: epic.id, cascade: true }),
        Layer.mergeAll(
          Layer.succeed(EpicRepositoryTag, epicRepo),
          Layer.succeed(StoryRepositoryTag, storyRepo),
          Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
        )
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({
        epicId: epic.id,
        affectedRecords: 1001,
        limit: 1000,
      })
    }
  })
})
