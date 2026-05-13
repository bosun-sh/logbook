import { beforeEach, describe, expect, test } from "bun:test"
import type { Epic } from "@logbook/epic/schema.js"
import { createStory } from "@logbook/story/create.js"
import { getStory } from "@logbook/story/get.js"
import type { Story } from "@logbook/story/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

class InMemoryStoryRepository implements StoryRepositoryShape {
  private readonly store = new Map<string, Story>()

  create(story: Story) {
    if (
      [...this.store.values()].some(
        (record) => record.id === story.id && record.deletedAt === undefined
      )
    ) {
      return Effect.fail({
        _tag: "conflict",
        message: `story ${story.id} already exists`,
        id: story.id,
      })
    }

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

    const deletedAt = "2026-01-02T12:34:56.789Z"
    const tombstoned = {
      ...story,
      updatedAt: deletedAt,
      deletedAt,
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
    if (epic === undefined) {
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

    const deletedAt = "2026-01-02T12:34:56.789Z"
    const tombstoned = {
      ...epic,
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

const StoryRepositoryTag = Context.GenericTag<StoryRepositoryShape>("StoryRepository")
const EpicRepositoryTag = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

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

const runWithRepos = <A>(
  effect: Effect.Effect<A, unknown, StoryRepositoryShape | EpicRepositoryShape>
) =>
  run(
    Effect.provide(
      effect,
      Layer.mergeAll(
        Layer.succeed(StoryRepositoryTag, storyRepo),
        Layer.succeed(EpicRepositoryTag, epicRepo)
      )
    )
  )

const runWithClockAndRepos = <A>(
  effect: Effect.Effect<A, unknown, StoryRepositoryShape | EpicRepositoryShape | Clock.Clock>
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.mergeAll(
        Layer.succeed(StoryRepositoryTag, storyRepo),
        Layer.succeed(EpicRepositoryTag, epicRepo)
      )
    )
  )

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
  storyIds: ["story_existing"],
  contextEntryIds: [],
  externalLinks: [],
  ...overrides,
})

let storyRepo: InMemoryStoryRepository
let epicRepo: InMemoryEpicRepository

beforeEach(() => {
  storyRepo = new InMemoryStoryRepository()
  epicRepo = new InMemoryEpicRepository()
})

describe("createStory", () => {
  test("creates a backlog story under an existing epic and appends its id once", async () => {
    const epic = makeEpic()
    await run(epicRepo.create(epic))

    const result = await runWithClockAndRepos(
      createStory({
        epicId: epic.id,
        title: "Schema migration",
        description: "Implement story CRUD",
        userValue: "Safer migration delivery",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected createStory to succeed")
    }

    expect(result.data.story.status).toBe("backlog")
    expect(result.data.story.epicId).toBe(epic.id)
    expect(result.data.story.taskIds).toEqual([])
    expect(result.data.story.contextEntryIds).toEqual([])
    expect(result.data.story.createdAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.story.updatedAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.story.id.startsWith("story_")).toBe(true)

    const fetched = await runWithRepos(getStory({ id: result.data.story.id }))
    expect(fetched).toEqual({
      ok: true,
      data: { story: result.data.story },
    })

    const updatedEpic = epicRepo.inspect(epic.id)
    expect(updatedEpic).toBeDefined()
    expect(updatedEpic!.storyIds).toEqual(["story_existing", result.data.story.id])
    expect(new Set(updatedEpic!.storyIds).size).toBe(updatedEpic!.storyIds.length)
  })

  test("returns not_found for an unknown parent epic", async () => {
    const result = await runWithClockAndRepos(
      createStory({
        epicId: "epic_missing",
        title: "Schema migration",
        description: "Implement story CRUD",
        userValue: "Safer migration delivery",
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "epic_missing" })
    }

    expect(await run(storyRepo.list())).toEqual([])
  })

  test("returns hierarchy_violation for a deleted parent epic", async () => {
    const epic = makeEpic({
      deletedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    await run(epicRepo.create(epic))

    const result = await runWithClockAndRepos(
      createStory({
        epicId: epic.id,
        title: "Schema migration",
        description: "Implement story CRUD",
        userValue: "Safer migration delivery",
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({ epicId: epic.id })
    }

    expect(await run(storyRepo.list())).toEqual([])
  })

  test("returns hierarchy_violation when appending a story would exceed the epic bound", async () => {
    const epic = makeEpic({
      storyIds: Array.from(
        { length: 1000 },
        (_, index) => `story_${String(index).padStart(32, "0")}`
      ),
    })
    await run(epicRepo.create(epic))

    const result = await runWithClockAndRepos(
      createStory({
        epicId: epic.id,
        title: "Schema migration",
        description: "Implement story CRUD",
        userValue: "Safer migration delivery",
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("hierarchy_violation")
      expect(result.error.details).toEqual({ epicId: epic.id, limit: 1000 })
    }

    expect(await run(storyRepo.list())).toEqual([])
    expect(epicRepo.inspect(epic.id)?.storyIds).toHaveLength(1000)
  })
})
