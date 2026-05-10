import { beforeEach, describe, expect, test } from "bun:test"
import { attachContext, normalizeAttachmentTarget } from "@logbook/context/attachments.js"
import { createContextEntry } from "@logbook/context/create.js"
import { deleteContextEntry } from "@logbook/context/delete.js"
import { listContextEntries } from "@logbook/context/list.js"
import type { ContextEntry } from "@logbook/context/schema.js"
import { normalizeTopic, normalizeTopics } from "@logbook/context/topics.js"
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

class InMemoryContextRepository implements ContextRepositoryShape {
  private readonly store = new Map<string, ContextEntry>()

  create(entry: ContextEntry) {
    if (
      [...this.store.values()].some(
        (record) => record.id === entry.id && record.deletedAt === undefined
      )
    ) {
      return Effect.fail({
        _tag: "conflict",
        message: `context entry ${entry.id} already exists`,
        id: entry.id,
      })
    }

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

    const deletedAt = "2026-01-03T09:10:11.123Z"
    const tombstoned = {
      ...entry,
      updatedAt: deletedAt,
      deletedAt,
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }
}

class InMemoryActiveOnlyContextRepository implements Omit<ContextRepositoryShape, "listAll"> {
  private readonly store = new Map<string, ContextEntry>()

  create(entry: ContextEntry) {
    if (
      [...this.store.values()].some(
        (record) => record.id === entry.id && record.deletedAt === undefined
      )
    ) {
      return Effect.fail({
        _tag: "conflict",
        message: `context entry ${entry.id} already exists`,
        id: entry.id,
      })
    }

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

    const deletedAt = "2026-01-03T09:10:11.123Z"
    const tombstoned = {
      ...entry,
      updatedAt: deletedAt,
      deletedAt,
    }
    this.store.set(id, tombstoned)
    return Effect.succeed(tombstoned)
  }
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
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
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

const runWithRepo = <A>(
  effect: Effect.Effect<A, unknown, ContextRepositoryShape>,
  repo: ContextRepositoryShape
) => run(Effect.provide(effect, Layer.succeed(ContextRepositoryTag, repo)))

const runWithClockAndRepo = <A>(
  effect: Effect.Effect<A, unknown, ContextRepositoryShape | Clock.Clock>,
  repo: InMemoryContextRepository
) =>
  run(
    Effect.provide(Effect.withClock(fixedClock)(effect), Layer.succeed(ContextRepositoryTag, repo))
  )

const runWithAttachmentRepos = <A>(
  effect: Effect.Effect<
    A,
    unknown,
    | ContextRepositoryShape
    | EpicRepositoryShape
    | StoryRepositoryShape
    | TaskRepositoryPort
    | Clock.Clock
  >,
  repositories: {
    readonly contextRepo: InMemoryContextRepository
    readonly epicRepo: InMemoryEpicRepository
    readonly storyRepo: InMemoryStoryRepository
    readonly taskRepo: InMemoryTaskRepository
  }
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.mergeAll(
        Layer.succeed(ContextRepositoryTag, repositories.contextRepo),
        Layer.succeed(EpicRepositoryTag, repositories.epicRepo),
        Layer.succeed(StoryRepositoryTag, repositories.storyRepo),
        Layer.succeed(TaskRepository, repositories.taskRepo as unknown as TaskRepositoryPort)
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

let repo: InMemoryContextRepository

beforeEach(() => {
  repo = new InMemoryContextRepository()
})

describe("createContextEntry validation", () => {
  test("normalizes topic spellings and rejects empty normalized topics", () => {
    expect(normalizeTopic("  MixED\tCase   Topic  ")).toEqual({
      ok: true,
      data: "mixed case topic",
    })

    const empty = normalizeTopic(" \n\t ")
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.error.code).toBe("validation_error")
      expect(empty.error.details).toEqual({ field: "topic" })
    }
  })

  test("deduplicates equivalent topic spellings and enforces bounds", () => {
    expect(
      normalizeTopics([" Architecture ", "architecture", "  ARCHITECTURE  ", "migration"])
    ).toEqual({
      ok: true,
      data: ["architecture", "migration"],
    })

    const tooMany = normalizeTopics(
      Array.from({ length: 51 }, (_, index) => `topic ${String(index + 1).padStart(2, "0")}`)
    )
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) {
      expect(tooMany.error.code).toBe("validation_error")
      expect(tooMany.error.details).toEqual({
        field: "topics",
        maxItems: 50,
      })
    }

    const tooLong = normalizeTopic("a".repeat(257))
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe("validation_error")
      expect(tooLong.error.details).toEqual({
        field: "topic",
        maxBytes: 256,
      })
    }
  })

  test("normalizes attachment targets and rejects empty identifiers", () => {
    expect(normalizeAttachmentTarget({ type: "epic", id: " epic_1 " })).toEqual({
      ok: true,
      data: { kind: "epic", id: "epic_1" },
    })

    expect(normalizeAttachmentTarget({ type: "topic", name: " architecture " })).toEqual({
      ok: true,
      data: { kind: "topic", id: "architecture" },
    })

    expect(normalizeAttachmentTarget({ type: "topic", name: "  ARCHITECTURE   NOTES  " })).toEqual({
      ok: true,
      data: { kind: "topic", id: "architecture notes" },
    })

    const emptyEntity = normalizeAttachmentTarget({ type: "task", id: "   " })
    expect(emptyEntity.ok).toBe(false)
    if (!emptyEntity.ok) {
      expect(emptyEntity.error.code).toBe("validation_error")
      expect(emptyEntity.error.details).toEqual({ field: "target.id" })
    }

    const emptyTopic = normalizeAttachmentTarget({ type: "topic", name: "   " })
    expect(emptyTopic.ok).toBe(false)
    if (!emptyTopic.ok) {
      expect(emptyTopic.error.code).toBe("validation_error")
      expect(emptyTopic.error.details).toEqual({ field: "target.name" })
    }
  })

  test("rejects empty body and invalid source input", async () => {
    const result = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "",
        source: {
          type: "manual",
          extra: true,
        } as never,
      }),
      repo
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
  })

  test("rejects title and body byte overflow", async () => {
    const longTitle = "x".repeat(513)
    const longBody = "x".repeat(262_145)

    const titleResult = await runWithClockAndRepo(
      createContextEntry({
        title: longTitle,
        body: "valid body",
      }),
      repo
    )

    expect(titleResult.ok).toBe(false)
    if (!titleResult.ok) {
      expect(titleResult.error.code).toBe("validation_error")
    }

    const bodyResult = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: longBody,
      }),
      repo
    )

    expect(bodyResult.ok).toBe(false)
    if (!bodyResult.ok) {
      expect(bodyResult.error.code).toBe("validation_error")
    }
  })

  test("enforces attachment and topic bounds during attach", async () => {
    const attachmentLimitEntry = makeContextEntry({
      id: "context_entry_attachment_limit",
      attachedTo: Array.from({ length: 1000 }, (_, index) => ({
        kind: "epic" as const,
        id: `epic_${String(index + 1).padStart(32, "0")}`,
      })),
    })
    const topicLimitEntry = makeContextEntry({
      id: "context_entry_topic_limit",
      attachedTo: Array.from({ length: 50 }, (_, index) => ({
        kind: "topic" as const,
        id: `topic ${index + 1}`,
      })),
    })
    const epicRepo = new InMemoryEpicRepository()
    const storyRepo = new InMemoryStoryRepository()
    const taskRepo = new InMemoryTaskRepository()

    await run(repo.create(attachmentLimitEntry))
    await run(repo.create(topicLimitEntry))
    await run(
      epicRepo.create({
        id: "epic_available",
        schemaVersion: "2",
        kind: "epic",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        title: "Available epic",
        description: "Available epic",
        outcome: "Available epic",
        status: "active",
        storyIds: [],
        contextEntryIds: [],
        externalLinks: [],
      })
    )

    const attachmentLimitResult = await runWithAttachmentRepos(
      attachContext({
        id: attachmentLimitEntry.id,
        target: {
          type: "epic",
          id: "epic_available",
        },
      }),
      {
        contextRepo: repo,
        epicRepo,
        storyRepo,
        taskRepo,
      }
    )

    expect(attachmentLimitResult.ok).toBe(false)
    if (!attachmentLimitResult.ok) {
      expect(attachmentLimitResult.error.code).toBe("validation_error")
      expect(attachmentLimitResult.error.details).toEqual({
        field: "attachedTo",
        maxItems: 1000,
      })
    }

    const topicLimitResult = await runWithAttachmentRepos(
      attachContext({
        id: topicLimitEntry.id,
        target: {
          type: "topic",
          name: "new topic",
        },
      }),
      {
        contextRepo: repo,
        epicRepo,
        storyRepo,
        taskRepo,
      }
    )

    expect(topicLimitResult.ok).toBe(false)
    if (!topicLimitResult.ok) {
      expect(topicLimitResult.error.code).toBe("validation_error")
      expect(topicLimitResult.error.details).toEqual({
        field: "topics",
        maxItems: 50,
      })
    }
  })
})

describe("listContextEntries", () => {
  test("matches topic filters using normalized comparison", async () => {
    const entry = makeContextEntry({
      id: "context_entry_topic_filter",
      topics: ["architecture notes"],
    })
    await run(repo.create(entry))

    const result = await runWithRepo(
      listContextEntries({ topic: "  Architecture   Notes  " }),
      repo
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected listContextEntries to succeed")
    }

    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]?.id).toBe(entry.id)
  })

  test("orders deterministically, paginates with a cursor, and emits has_more", async () => {
    const baseTime = Date.parse("2026-01-02T00:00:00.000Z")
    const ordered = Array.from({ length: 201 }, (_, index) =>
      makeContextEntry({
        id: `context_entry_${String(index + 1).padStart(32, "0")}`,
        title: `Context ${index + 1}`,
        createdAt: new Date(baseTime + index * 1000).toISOString(),
        updatedAt: new Date(baseTime + index * 1000).toISOString(),
      })
    )

    for (const entry of ordered) {
      await run(repo.create(entry))
    }

    const firstPage = await runWithRepo(listContextEntries({}), repo)
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected listContextEntries to succeed")
    }

    expect(firstPage.data.items).toHaveLength(200)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.items[0]?.id).toBe(ordered[200]?.id)
    expect(firstPage.data.items[199]?.id).toBe(ordered[1]?.id)
    expect(firstPage.warnings).toEqual([
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: {
          cursor: expect.any(String),
        },
      },
    ])

    const secondPage = await runWithRepo(
      listContextEntries({ cursor: firstPage.data.nextCursor }),
      repo
    )
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) {
      throw new Error("expected second page to succeed")
    }

    expect(secondPage.data.items).toHaveLength(1)
    expect(secondPage.data.hasMore).toBe(false)
    expect(secondPage.data.items[0]?.id).toBe(ordered[0]?.id)
  })

  test("omits deleted entries unless explicitly requested", async () => {
    const entry = makeContextEntry({ id: "context_entry_deleted" })
    await run(repo.create(entry))
    await runWithClockAndRepo(deleteContextEntry({ id: entry.id }), repo)

    const activeOnly = await runWithRepo(listContextEntries({}), repo)
    expect(activeOnly.ok).toBe(true)
    if (!activeOnly.ok) {
      throw new Error("expected listContextEntries to succeed")
    }

    expect(activeOnly.data.items).toEqual([])

    const withDeleted = await runWithRepo(listContextEntries({ includeDeleted: true }), repo)
    expect(withDeleted.ok).toBe(true)
    if (!withDeleted.ok) {
      throw new Error("expected listContextEntries to succeed")
    }

    expect(withDeleted.data.items).toHaveLength(1)
    expect(withDeleted.data.items[0]?.deletedAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("returns a structured unsupported error when includeDeleted is requested without listAll", async () => {
    const activeOnlyRepo = new InMemoryActiveOnlyContextRepository()
    const entry = makeContextEntry({ id: "context_entry_active_only" })
    await run(activeOnlyRepo.create(entry))

    const result = await runWithRepo(listContextEntries({ includeDeleted: true }), activeOnlyRepo)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
      expect(result.error.details).toEqual({
        field: "includeDeleted",
        supported: false,
      })
    }
  })
})
