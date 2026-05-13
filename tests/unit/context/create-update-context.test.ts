import { beforeEach, describe, expect, test } from "bun:test"
import { createContextEntry } from "@logbook/context/create.js"
import { deleteContextEntry } from "@logbook/context/delete.js"
import { getContextEntry } from "@logbook/context/get.js"
import type { ContextEntry } from "@logbook/context/schema.js"
import { normalizeTopic, normalizeTopics } from "@logbook/context/topics.js"
import { updateContextEntry } from "@logbook/context/update.js"
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

  inspect(id: string) {
    return this.store.get(id)
  }
}

const ContextRepositoryTag = Context.GenericTag<ContextRepositoryShape>("ContextRepository")

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
  repo: InMemoryContextRepository
) => run(Effect.provide(effect, Layer.succeed(ContextRepositoryTag, repo)))

const runWithClockAndRepo = <A>(
  effect: Effect.Effect<A, unknown, ContextRepositoryShape | Clock.Clock>,
  repo: InMemoryContextRepository
) =>
  run(
    Effect.provide(Effect.withClock(fixedClock)(effect), Layer.succeed(ContextRepositoryTag, repo))
  )

let repo: InMemoryContextRepository

beforeEach(() => {
  repo = new InMemoryContextRepository()
})

describe("createContextEntry", () => {
  test("normalizes topic spellings for downstream context use", () => {
    expect(normalizeTopic("  Architecture   Notes  ")).toEqual({
      ok: true,
      data: "architecture notes",
    })

    expect(normalizeTopics(["Architecture", "architecture", "  architecture  "])).toEqual({
      ok: true,
      data: ["architecture"],
    })
  })

  test("creates a context entry with canonical defaults, normalizes topics, and persists it", async () => {
    const result = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "Reusable migration guidance",
        topics: ["  Architecture   Notes  ", "ARCHITECTURE NOTES", "  migration  notes  "],
        source: {
          type: "manual",
          recordId: "task_17",
        },
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected createContextEntry to succeed")
    }

    expect(result.data.contextEntry.kind).toBe("context_entry")
    expect(result.data.contextEntry.createdAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.contextEntry.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.contextEntry.topics).toEqual(["architecture notes", "migration notes"])
    expect(result.data.contextEntry.attachedTo).toEqual([])
    expect(result.data.contextEntry.relevanceHints).toEqual([])

    const fetched = await runWithRepo(getContextEntry({ id: result.data.contextEntry.id }), repo)
    expect(fetched).toEqual({
      ok: true,
      data: { contextEntry: result.data.contextEntry },
    })
  })

  test("rejects empty normalized topics and topic overflow", async () => {
    const emptyTopics = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "Reusable migration guidance",
        topics: ["   "],
      }),
      repo
    )

    expect(emptyTopics.ok).toBe(false)
    if (!emptyTopics.ok) {
      expect(emptyTopics.error.code).toBe("validation_error")
    }

    const tooManyTopics = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "Reusable migration guidance",
        topics: Array.from(
          { length: 51 },
          (_, index) => `topic ${String(index + 1).padStart(2, "0")}`
        ),
      }),
      repo
    )

    expect(tooManyTopics.ok).toBe(false)
    if (!tooManyTopics.ok) {
      expect(tooManyTopics.error.code).toBe("validation_error")
    }
  })
})

describe("updateContextEntry and deleteContextEntry", () => {
  test("updates fields, normalizes topics, preserves existing attachments, and tombstones entries", async () => {
    const created = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "Reusable migration guidance",
        topics: ["architecture"],
        source: {
          type: "manual",
          recordId: "task_17",
        },
      }),
      repo
    )

    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error("expected createContextEntry to succeed")
    }

    const updated = await runWithClockAndRepo(
      updateContextEntry({
        id: created.data.contextEntry.id,
        title: "Updated architecture note",
        body: "Updated reusable migration guidance",
        topics: [" Architecture ", "ARCHITECTURE", "  migration  notes  "],
        source: {
          type: "file",
          uri: "file:///notes/context.md",
        },
        relevanceHints: ["task-17", "task-18"],
      }),
      repo
    )

    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      throw new Error("expected updateContextEntry to succeed")
    }

    expect(updated.data.contextEntry.title).toBe("Updated architecture note")
    expect(updated.data.contextEntry.body).toBe("Updated reusable migration guidance")
    expect(updated.data.contextEntry.topics).toEqual(["architecture", "migration notes"])
    expect(updated.data.contextEntry.relevanceHints).toEqual(["task-17", "task-18"])
    expect(updated.data.contextEntry.attachedTo).toEqual([])

    const deleted = await runWithClockAndRepo(
      deleteContextEntry({ id: updated.data.contextEntry.id }),
      repo
    )

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) {
      throw new Error("expected deleteContextEntry to succeed")
    }

    expect(deleted.data.contextEntry.deletedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(deleted.data.contextEntry.updatedAt).toBe("2026-01-03T09:10:11.123Z")

    const fetched = await runWithRepo(getContextEntry({ id: created.data.contextEntry.id }), repo)
    expect(fetched.ok).toBe(false)
    if (!fetched.ok) {
      expect(fetched.error.code).toBe("not_found")
    }
  })

  test("rejects updates with empty normalized topics and topic overflow", async () => {
    const created = await runWithClockAndRepo(
      createContextEntry({
        title: "Architecture note",
        body: "Reusable migration guidance",
        topics: ["architecture"],
        source: {
          type: "manual",
          recordId: "task_17",
        },
      }),
      repo
    )

    expect(created.ok).toBe(true)
    if (!created.ok) {
      throw new Error("expected createContextEntry to succeed")
    }

    const emptyTopics = await runWithClockAndRepo(
      updateContextEntry({
        id: created.data.contextEntry.id,
        topics: ["   "],
      }),
      repo
    )

    expect(emptyTopics.ok).toBe(false)
    if (!emptyTopics.ok) {
      expect(emptyTopics.error.code).toBe("validation_error")
    }

    const tooManyTopics = await runWithClockAndRepo(
      updateContextEntry({
        id: created.data.contextEntry.id,
        topics: Array.from(
          { length: 51 },
          (_, index) => `topic ${String(index + 1).padStart(2, "0")}`
        ),
      }),
      repo
    )

    expect(tooManyTopics.ok).toBe(false)
    if (!tooManyTopics.ok) {
      expect(tooManyTopics.error.code).toBe("validation_error")
    }
  })
})
