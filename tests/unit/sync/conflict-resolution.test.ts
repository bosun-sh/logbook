import { beforeEach, describe, expect, test } from "bun:test"
import {
  createSyncConflict,
  listSyncConflicts,
  resolveSyncConflict,
} from "@logbook/sync/conflicts.js"
import type { SyncConflict } from "@logbook/sync/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

class InMemorySyncConflictRepository implements SyncConflictRepositoryShape {
  private readonly store = new Map<string, SyncConflict>()
  failCreate: unknown | undefined
  failList: unknown | undefined
  failUpdate: unknown | undefined

  constructor(initialConflicts: readonly SyncConflict[] = []) {
    for (const conflict of initialConflicts) {
      this.store.set(conflict.id, conflict)
    }
  }

  create(conflict: SyncConflict) {
    if (this.failCreate !== undefined) {
      return Effect.fail(this.failCreate)
    }

    this.store.set(conflict.id, conflict)
    return Effect.succeed(conflict)
  }

  get(id: string) {
    const conflict = this.store.get(id)
    return conflict === undefined
      ? Effect.fail({ _tag: "not_found", message: `sync conflict ${id} was not found`, id })
      : Effect.succeed(conflict)
  }

  list() {
    if (this.failList !== undefined) {
      return Effect.fail(this.failList)
    }

    return Effect.succeed([...this.store.values()])
  }

  update(conflict: SyncConflict) {
    if (this.failUpdate !== undefined) {
      return Effect.fail(this.failUpdate)
    }
    if (!this.store.has(conflict.id)) {
      return Effect.fail({
        _tag: "not_found",
        message: `sync conflict ${conflict.id} was not found`,
      })
    }

    this.store.set(conflict.id, conflict)
    return Effect.succeed(conflict)
  }

  inspectAll() {
    return [...this.store.values()]
  }
}

const SyncConflictRepositoryTag =
  Context.GenericTag<SyncConflictRepositoryShape>("SyncConflictRepository")

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
  effect: Effect.Effect<A, unknown, SyncConflictRepositoryShape | Clock.Clock>
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.succeed(SyncConflictRepositoryTag, repo)
    )
  )

const makeConflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  id: "sync_conflict_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "sync_conflict",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provider: "linear",
  localRecord: {
    kind: "task",
    id: "task_1",
  },
  remoteRecord: {
    id: "LIN-1",
    url: "https://linear.app/example/issue/LIN-1",
  },
  fields: [
    {
      path: "title",
      baseValue: "Base title",
      localValue: "Local title",
      remoteValue: "Remote title",
    },
  ],
  status: "open",
  ...overrides,
})

let repo: InMemorySyncConflictRepository

beforeEach(() => {
  repo = new InMemorySyncConflictRepository()
})

describe("sync conflict use cases", () => {
  test("creates, lists, and resolves a conflict with a provider-independent event payload", async () => {
    const created = await runWithRepo(
      createSyncConflict({
        provider: "linear",
        localRecord: { kind: "task", id: "task_1" },
        remoteRecord: { id: "LIN-1", url: "https://linear.app/example/issue/LIN-1" },
        fields: [
          {
            path: "title",
            baseValue: "Base title",
            localValue: "Local title",
            remoteValue: "Remote title",
          },
        ],
      })
    )

    expect(created.ok).toBe(true)
    if (!created.ok || created.data.conflict === undefined) {
      throw new Error("expected conflict creation to succeed")
    }

    const listed = await runWithRepo(listSyncConflicts({ provider: "linear", status: "open" }))
    expect(listed).toMatchObject({
      ok: true,
      data: {
        items: [expect.objectContaining({ id: created.data.conflict.id, status: "open" })],
        hasMore: false,
      },
    })

    const resolved = await runWithRepo(
      resolveSyncConflict({
        id: created.data.conflict.id,
        resolution: "use_remote",
      })
    )

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) {
      throw new Error("expected conflict resolution to succeed")
    }

    expect(resolved.data.conflict).toMatchObject({
      id: created.data.conflict.id,
      status: "resolved",
      resolution: "use_remote",
      resolvedAt: "2026-01-02T12:34:56.789Z",
      updatedAt: "2026-01-02T12:34:56.789Z",
    })
    expect(resolved.data.event).toEqual({
      result: "resolved",
      providerId: "linear",
      conflictId: created.data.conflict.id,
      resolution: "use_remote",
      fields: ["title"],
    })
  })

  test("manual resolution requires manualRecord and rejects fields outside the conflict set", async () => {
    repo = new InMemorySyncConflictRepository([makeConflict()])

    const missingManual = await runWithRepo(
      resolveSyncConflict({
        id: "sync_conflict_00000000000000000000000000000001",
        resolution: "manual",
      })
    )
    const extraField = await runWithRepo(
      resolveSyncConflict({
        id: "sync_conflict_00000000000000000000000000000001",
        resolution: "manual",
        manualRecord: {
          entityType: "task",
          entityId: "task_1",
          fields: {
            title: "Resolved title",
            description: "unexpected",
          },
          rationale: "Use the clearer title.",
        },
      })
    )

    expect(missingManual).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    })
    expect(extraField).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    })
    expect(repo.inspectAll()[0]?.status).toBe("open")
  })

  test("accepts manual resolution for fields named by the conflict", async () => {
    repo = new InMemorySyncConflictRepository([makeConflict()])

    const result = await runWithRepo(
      resolveSyncConflict({
        id: "sync_conflict_00000000000000000000000000000001",
        resolution: "manual",
        manualRecord: {
          entityType: "task",
          entityId: "task_1",
          fields: {
            title: "Resolved title",
          },
          rationale: "Use a title that reflects both sources.",
          resolvedBy: "agent",
        },
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected manual resolution to succeed")
    }
    expect(result.data.conflict.status).toBe("resolved")
    expect(result.data.conflict.resolution).toBe("manual")
    expect(result.data.event).toMatchObject({
      result: "resolved",
      resolution: "manual",
      fields: ["title"],
    })
  })

  test("rejects conflicts with more than 100 fields", async () => {
    const result = await runWithRepo(
      createSyncConflict({
        provider: "linear",
        localRecord: { kind: "task", id: "task_1" },
        remoteRecord: { id: "LIN-1" },
        fields: Array.from({ length: 101 }, (_, index) => ({
          path: `field_${index}`,
          baseValue: "base",
          localValue: `local-${index}`,
          remoteValue: `remote-${index}`,
        })),
      })
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
  })

  test("paginates conflicts at 200 with a warning and cursor", async () => {
    repo = new InMemorySyncConflictRepository(
      Array.from({ length: 201 }, (_, index) =>
        makeConflict({
          id: `sync_conflict_${index.toString().padStart(32, "0")}`,
          createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index).toISOString(),
          localRecord: { kind: "task", id: `task_${index}` },
          remoteRecord: { id: `LIN-${index}` },
        })
      )
    )

    const firstPage = await runWithRepo(listSyncConflicts({}))

    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected first page to succeed")
    }

    expect(firstPage.data.items).toHaveLength(200)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.nextCursor).toEqual(expect.any(String))
    expect(firstPage.warnings).toEqual([
      {
        code: "result_truncated",
        message: "Sync conflict list exceeded the 200 item limit.",
        details: {
          limit: 200,
          hasMore: true,
          nextCursor: firstPage.data.nextCursor,
        },
      },
    ])

    const secondPage = await runWithRepo(listSyncConflicts({ cursor: firstPage.data.nextCursor }))
    expect(secondPage).toMatchObject({
      ok: true,
      data: {
        items: [expect.objectContaining({ localRecord: { id: "task_200", kind: "task" } })],
        hasMore: false,
      },
    })
  })

  test("maps repository failures to structured errors", async () => {
    repo.failCreate = { _tag: "storage_error", message: "write failed" }

    const result = await runWithRepo(
      createSyncConflict({
        provider: "linear",
        localRecord: { kind: "task", id: "task_1" },
        remoteRecord: { id: "LIN-1" },
        fields: [
          {
            path: "title",
            baseValue: "Base title",
            localValue: "Local title",
            remoteValue: "Remote title",
          },
        ],
      })
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "storage_error",
      },
    })
  })
})
