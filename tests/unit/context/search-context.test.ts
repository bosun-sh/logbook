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
    const entry = this.entries.find(
      (candidate) => candidate.id === id && candidate.deletedAt === undefined
    )
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

const makeContextEntry = (index: number, overrides: Partial<ContextEntry> = {}): ContextEntry => ({
  id: `context_entry_${String(index).padStart(2, "0")}`,
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: `2026-01-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
  title: `Migration note ${index}`,
  body: `Migration guidance ${index}`,
  topics: [],
  attachedTo: [],
  relevanceHints: [],
  ...overrides,
})

describe("searchContextEntries", () => {
  test("excludes deleted entries by default", async () => {
    const repo = new InMemoryContextRepository([
      makeContextEntry(1, { id: "context_entry_live", title: "Live migration note" }),
      makeContextEntry(2, {
        id: "context_entry_deleted",
        title: "Deleted migration note",
        deletedAt: "2026-01-07T00:00:00.000Z",
      }),
    ])

    const result = await run(searchContextEntries({ query: "migration" }), repo)

    expect(result).toEqual({
      ok: true,
      data: {
        items: [expect.objectContaining({ id: "context_entry_live" })],
        hasMore: false,
      },
    })
  })

  test("fails when query exceeds 2048 bytes", async () => {
    const repo = new InMemoryContextRepository([])

    const result = await run(
      searchContextEntries({
        query: "a".repeat(2049),
      }),
      repo
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
      expect(result.error.details).toEqual({
        field: "query",
        maxBytes: 2048,
      })
    }
  })

  test("applies the default limit, emits has_more, and continues from the cursor", async () => {
    const repo = new InMemoryContextRepository(
      Array.from({ length: 21 }, (_, index) =>
        makeContextEntry(index + 1, {
          updatedAt: `2026-02-${String(21 - index).padStart(2, "0")}T00:00:00.000Z`,
        })
      )
    )

    const firstPage = await run(searchContextEntries({ query: "migration" }), repo)

    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected searchContextEntries to succeed")
    }

    expect(firstPage.data.items).toHaveLength(20)
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

    const secondPage = await run(
      searchContextEntries({
        query: "migration",
        cursor: firstPage.data.nextCursor,
      }),
      repo
    )

    expect(secondPage).toEqual({
      ok: true,
      data: {
        items: [expect.objectContaining({ id: "context_entry_21" })],
        hasMore: false,
      },
    })
  })

  test("fails with storage_error when the entity scan bound is exceeded", async () => {
    const repo = new InMemoryContextRepository(
      Array.from({ length: 100_001 }, (_, index) => makeContextEntry(index + 1))
    )

    const result = await run(searchContextEntries({ query: "migration" }), repo)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "storage_error",
        message: "context search scan exceeded 100000 entries",
        details: {
          bound: 100000,
        },
      })
    }
  })
})
