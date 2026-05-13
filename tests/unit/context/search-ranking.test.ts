import { describe, expect, test } from "bun:test"
import type { ContextEntry } from "@logbook/context/schema.js"
import { searchContextEntries } from "@logbook/context/search.js"
import { Context, Effect, Layer } from "effect"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

class InMemoryContextRepository implements ContextRepositoryShape {
  constructor(private readonly entries: readonly ContextEntry[]) {}

  create(entry: ContextEntry) {
    return Effect.succeed(entry)
  }

  get(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id)
    return entry === undefined
      ? Effect.fail({ _tag: "not_found", message: `context entry ${id} was not found`, id })
      : Effect.succeed(entry)
  }

  list() {
    return Effect.succeed(this.entries.filter((entry) => entry.deletedAt === undefined))
  }

  listAll() {
    return Effect.succeed(this.entries)
  }

  update(entry: ContextEntry) {
    return Effect.succeed(entry)
  }

  tombstone(id: string) {
    return Effect.fail({ _tag: "not_found", message: `context entry ${id} was not found`, id })
  }
}

const ContextRepositoryTag = Context.GenericTag<ContextRepositoryShape>("ContextRepository")

const run = <A>(
  effect: Effect.Effect<A, unknown, ContextRepositoryShape>,
  repo: ContextRepositoryShape
) =>
  Effect.runPromise(
    Effect.provide(effect, Layer.succeed(ContextRepositoryTag, repo)) as Effect.Effect<A, never>
  )

const makeContextEntry = (overrides: Partial<ContextEntry> = {}): ContextEntry => ({
  id: "context_entry_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Architecture note",
  body: "Migration guidance",
  topics: [],
  attachedTo: [],
  relevanceHints: [],
  ...overrides,
})

describe("searchContextEntries ranking", () => {
  test("ranks direct entity attachments before topic matches and query-only matches", async () => {
    const repo = new InMemoryContextRepository([
      makeContextEntry({
        id: "context_entry_03",
        updatedAt: "2026-01-04T00:00:00.000Z",
        title: "Migration plan",
        body: "Query-only body match",
      }),
      makeContextEntry({
        id: "context_entry_02",
        updatedAt: "2026-01-03T00:00:00.000Z",
        title: "Topic note",
        body: "Unrelated text",
        topics: ["architecture"],
      }),
      makeContextEntry({
        id: "context_entry_04",
        updatedAt: "2026-01-05T00:00:00.000Z",
        title: "Task attachment",
        body: "Migration guidance for tasks",
        attachedTo: [{ kind: "task", id: "task_123" }],
      }),
      makeContextEntry({
        id: "context_entry_01",
        updatedAt: "2026-01-02T00:00:00.000Z",
        title: "Epic attachment",
        body: "Migration guidance for epics",
        attachedTo: [{ kind: "epic", id: "epic_123" }],
      }),
    ])

    const result = await run(
      searchContextEntries({
        topic: "  ARCHITECTURE  ",
        query: "migration",
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected searchContextEntries to succeed")
    }

    expect(result.data.items.map((entry) => entry.id)).toEqual([
      "context_entry_04",
      "context_entry_01",
      "context_entry_02",
      "context_entry_03",
    ])
  })

  test("ranks the searched task attachment ahead of a topic-only match", async () => {
    const repo = new InMemoryContextRepository([
      makeContextEntry({
        id: "context_entry_topic",
        updatedAt: "2026-01-05T00:00:00.000Z",
        title: "Architecture topic",
        topics: ["architecture"],
      }),
      makeContextEntry({
        id: "context_entry_task",
        updatedAt: "2026-01-01T00:00:00.000Z",
        title: "Task note",
        attachedTo: [{ kind: "task", id: "task_123" }],
      }),
    ])

    const result = await run(
      searchContextEntries({
        taskId: "task_123",
        topic: "architecture",
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected searchContextEntries to succeed")
    }

    expect(result.data.items.map((entry) => entry.id)).toEqual([
      "context_entry_task",
      "context_entry_topic",
    ])
  })

  test("breaks equal scores by updatedAt descending and then id ascending", async () => {
    const repo = new InMemoryContextRepository([
      makeContextEntry({
        id: "context_entry_b",
        updatedAt: "2026-01-02T00:00:00.000Z",
        title: "Migration B",
      }),
      makeContextEntry({
        id: "context_entry_a",
        updatedAt: "2026-01-02T00:00:00.000Z",
        title: "Migration A",
      }),
      makeContextEntry({
        id: "context_entry_c",
        updatedAt: "2026-01-03T00:00:00.000Z",
        title: "Migration C",
      }),
    ])

    const result = await run(
      searchContextEntries({
        query: "migration",
      }),
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected searchContextEntries to succeed")
    }

    expect(result.data.items.map((entry) => entry.id)).toEqual([
      "context_entry_c",
      "context_entry_a",
      "context_entry_b",
    ])
  })
})
