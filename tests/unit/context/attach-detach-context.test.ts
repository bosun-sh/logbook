import { beforeEach, describe, expect, test } from "bun:test"
import { attachContext, detachContext } from "@logbook/context/attachments.js"
import type { ContextEntry } from "@logbook/context/schema.js"
import type { Epic } from "@logbook/epic/schema.js"
import type { Story } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

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

class InMemoryContextRepository implements ContextRepositoryShape {
  private readonly store = new Map<string, ContextEntry>()

  create(entry: ContextEntry) {
    this.store.set(entry.id, entry)
    return Effect.succeed(entry)
  }

  get(id: string) {
    const entry = this.store.get(id)
    if (entry === undefined || entry.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `context entry ${id} was not found`, id })
    }

    return Effect.succeed(entry)
  }

  list() {
    return Effect.succeed([...this.store.values()].filter((entry) => entry.deletedAt === undefined))
  }

  listAll() {
    return Effect.succeed([...this.store.values()])
  }

  update(entry: ContextEntry) {
    if (!this.store.has(entry.id) || this.store.get(entry.id)?.deletedAt !== undefined) {
      return Effect.fail({
        _tag: "not_found",
        message: `context entry ${entry.id} was not found`,
        id: entry.id,
      })
    }

    this.store.set(entry.id, entry)
    return Effect.succeed(entry)
  }

  tombstone(id: string) {
    const entry = this.store.get(id)
    if (entry === undefined || entry.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `context entry ${id} was not found`, id })
    }

    const tombstoned = {
      ...entry,
      deletedAt: "2026-01-03T09:10:11.123Z",
      updatedAt: "2026-01-03T09:10:11.123Z",
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }
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

    const tombstoned = {
      ...epic,
      deletedAt: "2026-01-03T09:10:11.123Z",
      updatedAt: "2026-01-03T09:10:11.123Z",
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }

  inspect(id: string) {
    return this.store.get(id)
  }
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
    if (story === undefined || story.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
    }

    const tombstoned = {
      ...story,
      deletedAt: "2026-01-03T09:10:11.123Z",
      updatedAt: "2026-01-03T09:10:11.123Z",
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }

  inspect(id: string) {
    return this.store.get(id)
  }
}

class InMemoryTaskRepository implements TaskRepositoryShape {
  private readonly store = new Map<string, Task>()

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
    if (!this.store.has(task.id) || this.store.get(task.id)?.deletedAt !== undefined) {
      return Effect.fail({
        _tag: "not_found",
        message: `task ${task.id} was not found`,
        id: task.id,
      })
    }

    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  inspect(id: string) {
    return this.store.get(id)
  }
}

const ContextRepositoryTag = Context.GenericTag<ContextRepositoryShape>("ContextRepository")
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

const runWithRepos = <A>(
  effect: Effect.Effect<
    A,
    unknown,
    | ContextRepositoryShape
    | EpicRepositoryShape
    | StoryRepositoryShape
    | TaskRepositoryPort
    | Clock.Clock
  >
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.mergeAll(
        Layer.succeed(ContextRepositoryTag, contextRepo),
        Layer.succeed(EpicRepositoryTag, epicRepo),
        Layer.succeed(StoryRepositoryTag, storyRepo),
        Layer.succeed(TaskRepository, taskRepo as unknown as TaskRepositoryPort)
      )
    )
  )

const makeContextEntry = (overrides: Partial<ContextEntry> = {}): ContextEntry => ({
  id: "context_entry_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Architecture note",
  body: "Reusable migration guidance",
  topics: [],
  attachedTo: [],
  relevanceHints: [],
  ...overrides,
})

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
  title: "Context workflow",
  description: "Story for context workflow",
  userValue: "Clear attachment flows",
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
  title: "Implement context attachments",
  description: "Implement context attachments",
  definitionOfDone: "All checks pass",
  project: "logbook",
  milestone: "v2",
  status: "todo",
  priority: 2,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 1,
    complexity: "small",
    fibonacci: 1,
    confidence: "medium",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

let contextRepo: InMemoryContextRepository
let epicRepo: InMemoryEpicRepository
let storyRepo: InMemoryStoryRepository
let taskRepo: InMemoryTaskRepository

beforeEach(async () => {
  contextRepo = new InMemoryContextRepository()
  epicRepo = new InMemoryEpicRepository()
  storyRepo = new InMemoryStoryRepository()
  taskRepo = new InMemoryTaskRepository()

  await run(contextRepo.create(makeContextEntry()))
  await run(epicRepo.create(makeEpic()))
  await run(storyRepo.create(makeStory()))
  await run(taskRepo.save(makeTask()))
})

describe("attachContext", () => {
  test("attaches once to an epic and updates the target context references", async () => {
    const first = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "epic",
          id: "epic_00000000000000000000000000000001",
        },
      })
    )

    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error("expected attachContext to succeed")
    }

    expect(first.data.contextEntry.attachedTo).toEqual([
      {
        kind: "epic",
        id: "epic_00000000000000000000000000000001",
      },
    ])
    expect(first.data.contextEntry.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(epicRepo.inspect("epic_00000000000000000000000000000001")?.contextEntryIds).toEqual([
      "context_entry_00000000000000000000000000000001",
    ])

    const second = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "epic",
          id: "epic_00000000000000000000000000000001",
        },
      })
    )

    expect(second.ok).toBe(true)
    if (!second.ok) {
      throw new Error("expected duplicate attachContext to succeed")
    }

    expect(second.data.contextEntry.attachedTo).toHaveLength(1)
    expect(epicRepo.inspect("epic_00000000000000000000000000000001")?.contextEntryIds).toEqual([
      "context_entry_00000000000000000000000000000001",
    ])
  })

  test("attaches to story, task, and topic targets", async () => {
    const storyResult = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "story",
          id: "story_00000000000000000000000000000001",
        },
      })
    )
    expect(storyResult.ok).toBe(true)

    const taskResult = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "task",
          id: "task_00000000000000000000000000000001",
        },
      })
    )
    expect(taskResult.ok).toBe(true)

    const topicResult = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "topic",
          name: " architecture ",
        },
      })
    )

    expect(topicResult.ok).toBe(true)
    if (!topicResult.ok) {
      throw new Error("expected topic attach to succeed")
    }

    expect(topicResult.data.contextEntry.attachedTo).toEqual([
      { kind: "story", id: "story_00000000000000000000000000000001" },
      { kind: "task", id: "task_00000000000000000000000000000001" },
      { kind: "topic", id: "architecture" },
    ])
    expect(storyRepo.inspect("story_00000000000000000000000000000001")?.contextEntryIds).toEqual([
      "context_entry_00000000000000000000000000000001",
    ])
    expect(taskRepo.inspect("task_00000000000000000000000000000001")?.contextEntryIds).toEqual([
      "context_entry_00000000000000000000000000000001",
    ])
  })

  test("returns not_found when the target entity is missing", async () => {
    const result = await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "story",
          id: "story_missing",
        },
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "story_missing" })
    }
  })
})

describe("detachContext", () => {
  test("removes only the requested attachment and target context reference", async () => {
    await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "epic",
          id: "epic_00000000000000000000000000000001",
        },
      })
    )
    await runWithRepos(
      attachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "story",
          id: "story_00000000000000000000000000000001",
        },
      })
    )

    const result = await runWithRepos(
      detachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "epic",
          id: "epic_00000000000000000000000000000001",
        },
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected detachContext to succeed")
    }

    expect(result.data.contextEntry.attachedTo).toEqual([
      {
        kind: "story",
        id: "story_00000000000000000000000000000001",
      },
    ])
    expect(epicRepo.inspect("epic_00000000000000000000000000000001")?.contextEntryIds).toEqual([])
    expect(storyRepo.inspect("story_00000000000000000000000000000001")?.contextEntryIds).toEqual([
      "context_entry_00000000000000000000000000000001",
    ])
  })

  test("is idempotent for missing existing attachments and topic detach", async () => {
    const entityResult = await runWithRepos(
      detachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "task",
          id: "task_00000000000000000000000000000001",
        },
      })
    )

    expect(entityResult.ok).toBe(true)
    if (!entityResult.ok) {
      throw new Error("expected detachContext to be idempotent for task attachments")
    }

    const topicResult = await runWithRepos(
      detachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "topic",
          name: "architecture",
        },
      })
    )

    expect(topicResult.ok).toBe(true)
    if (!topicResult.ok) {
      throw new Error("expected detachContext to be idempotent for topic attachments")
    }

    expect(topicResult.data.contextEntry.attachedTo).toEqual([])
  })

  test("returns not_found when detaching from a missing target entity", async () => {
    const result = await runWithRepos(
      detachContext({
        id: "context_entry_00000000000000000000000000000001",
        target: {
          type: "epic",
          id: "epic_missing",
        },
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "epic_missing" })
    }
  })
})
