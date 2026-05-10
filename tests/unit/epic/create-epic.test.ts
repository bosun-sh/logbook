import { beforeEach, describe, expect, test } from "bun:test"
import { createEpic } from "@logbook/epic/create.js"
import { getEpic } from "@logbook/epic/get.js"
import { listEpics } from "@logbook/epic/list.js"
import type { Epic } from "@logbook/epic/schema.js"
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
    if (
      [...this.store.values()].some(
        (record) => record.id === epic.id && record.deletedAt === undefined
      )
    ) {
      return Effect.fail({
        _tag: "conflict",
        message: `epic ${epic.id} already exists`,
        id: epic.id,
      })
    }

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

    const deletedAt = "2026-01-02T12:34:56.789Z"
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

const runWithRepo = <A>(
  effect: Effect.Effect<A, unknown, EpicRepositoryShape>,
  repo: InMemoryEpicRepository
) => run(Effect.provide(effect, Layer.succeed(EpicRepositoryTag, repo)))

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

let repo: InMemoryEpicRepository

beforeEach(() => {
  repo = new InMemoryEpicRepository()
})

describe("createEpic", () => {
  test("creates a backlog epic with empty attachments by default", async () => {
    const result = await runWithClockAndRepo(
      createEpic({
        title: "Migration foundation",
        description: "Shared migration work",
        outcome: "Stable v2 base",
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected createEpic to succeed")
    }

    expect(result.data.epic.status).toBe("backlog")
    expect(result.data.epic.storyIds).toEqual([])
    expect(result.data.epic.contextEntryIds).toEqual([])
    expect(result.data.epic.createdAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.epic.updatedAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.epic.id.startsWith("epic_")).toBe(true)

    const fetched = await runWithRepo(getEpic({ id: result.data.epic.id }), repo)
    expect(fetched).toEqual({
      ok: true,
      data: { epic: result.data.epic },
    })
  })

  test("preserves explicit owner and attachment lists", async () => {
    const result = await runWithClockAndRepo(
      createEpic({
        title: "Migration foundation",
        description: "Shared migration work",
        outcome: "Stable v2 base",
        owner: {
          id: "agent_1",
          title: "Owner",
        },
        storyIds: ["story_1"],
        contextEntryIds: ["context_entry_1"],
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected createEpic to succeed")
    }

    expect(result.data.epic.owner).toEqual({
      id: "agent_1",
      title: "Owner",
    })
    expect(result.data.epic.storyIds).toEqual(["story_1"])
    expect(result.data.epic.contextEntryIds).toEqual(["context_entry_1"])
  })

  test("getEpic returns not_found for unknown ids", async () => {
    const result = await runWithRepo(getEpic({ id: "epic_missing" }), repo)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("not_found")
      expect(result.error.details).toEqual({ id: "epic_missing" })
    }
  })
})

describe("listEpics", () => {
  test("orders deterministically, filters, and paginates with a cursor", async () => {
    const ordered = Array.from({ length: 201 }, (_, index) =>
      makeEpic({
        id: `epic_${String(index + 1).padStart(32, "0")}`,
        title: `Epic ${index + 1}`,
        status: index % 2 === 0 ? "active" : "backlog",
        owner:
          index % 2 === 0
            ? {
                id: "agent_1",
                title: "Owner",
              }
            : {
                id: "agent_2",
                title: "Other",
              },
        createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        updatedAt: `2026-01-02T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      })
    )

    for (const epic of ordered) {
      await run(repo.create(epic))
    }

    const filtered = await runWithRepo(listEpics({ status: "active", ownerId: "agent_1" }), repo)
    expect(filtered.ok).toBe(true)
    if (!filtered.ok) {
      throw new Error("expected listEpics to succeed")
    }

    expect(
      filtered.data.items.every((epic) => epic.status === "active" && epic.owner?.id === "agent_1")
    ).toBe(true)

    const firstPage = await runWithRepo(listEpics({}), repo)
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected listEpics to succeed")
    }

    expect(firstPage.data.items).toHaveLength(200)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.warnings).toEqual([
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: {
          cursor: expect.any(String),
        },
      },
    ])

    const secondPage = await runWithRepo(listEpics({ cursor: firstPage.data.nextCursor }), repo)
    expect(secondPage.ok).toBe(true)
    if (!secondPage.ok) {
      throw new Error("expected second page to succeed")
    }

    expect(secondPage.data.items).toHaveLength(1)
    expect(secondPage.data.hasMore).toBe(false)
    expect(secondPage.data.nextCursor).toBeUndefined()
  })
})
