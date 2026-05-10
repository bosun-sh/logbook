import { beforeEach, describe, expect, test } from "bun:test"
import { appendSyncEvent, listSyncEvents } from "@logbook/sync/events.js"
import type { SyncEvent } from "@logbook/sync/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

class InMemorySyncEventRepository implements SyncEventRepositoryShape {
  readonly created: SyncEvent[] = []
  failCreate: unknown | undefined
  failList: unknown | undefined

  constructor(initialEvents: readonly SyncEvent[] = []) {
    this.created = [...initialEvents]
  }

  create(event: SyncEvent) {
    if (this.failCreate !== undefined) {
      return Effect.fail(this.failCreate)
    }

    this.created.push(event)
    return Effect.succeed(event)
  }

  list() {
    if (this.failList !== undefined) {
      return Effect.fail(this.failList)
    }

    return Effect.succeed([...this.created])
  }
}

const SyncEventRepositoryTag = Context.GenericTag<SyncEventRepositoryShape>("SyncEventRepository")

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
  effect: Effect.Effect<A, unknown, SyncEventRepositoryShape | Clock.Clock>
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.succeed(SyncEventRepositoryTag, repo)
    )
  )

const makeEvent = (overrides: Partial<SyncEvent> = {}): SyncEvent => ({
  id: "sync_event_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "sync_event",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provider: "linear",
  direction: "pull",
  localRecordId: "task_1",
  remoteRecordId: "LIN-1",
  result: "updated",
  message: "Updated task_1 from LIN-1.",
  data: {
    result: "updated",
    providerId: "linear",
    entityType: "task",
    entityId: "task_1",
    remoteId: "LIN-1",
    fields: ["title"],
  },
  ...overrides,
})

let repo: InMemorySyncEventRepository

beforeEach(() => {
  repo = new InMemorySyncEventRepository()
})

describe("sync event use cases", () => {
  test("appends a canonical sync event with metadata and mapped payload fields", async () => {
    const result = await runWithRepo(
      appendSyncEvent({
        direction: "pull",
        message: "Imported Linear issue.",
        data: {
          result: "created",
          providerId: "linear",
          entityType: "task",
          entityId: "task_1",
          remoteId: "LIN-1",
          fields: ["title", "description"],
        },
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected appendSyncEvent to succeed")
    }

    expect(result.data.syncEvent).toMatchObject({
      schemaVersion: "2",
      kind: "sync_event",
      createdAt: "2026-01-02T12:34:56.789Z",
      updatedAt: "2026-01-02T12:34:56.789Z",
      provider: "linear",
      direction: "pull",
      localRecordId: "task_1",
      remoteRecordId: "LIN-1",
      result: "created",
      message: "Imported Linear issue.",
      data: {
        result: "created",
        providerId: "linear",
        entityType: "task",
        entityId: "task_1",
        remoteId: "LIN-1",
        fields: ["title", "description"],
      },
    })
    expect(result.data.syncEvent.id.startsWith("sync_event_")).toBe(true)
    expect(repo.created).toHaveLength(1)
  })

  test("accepts provider-independent conflict and resolved payloads", async () => {
    const conflict = await runWithRepo(
      appendSyncEvent({
        direction: "pull",
        data: {
          result: "conflict",
          providerId: "linear",
          conflictId: "sync_conflict_1",
          entityType: "task",
          entityId: "task_1",
          fields: ["title"],
        },
      })
    )
    const resolved = await runWithRepo(
      appendSyncEvent({
        direction: "resolve",
        data: {
          result: "resolved",
          providerId: "linear",
          conflictId: "sync_conflict_1",
          resolution: "manual",
          fields: ["title"],
        },
      })
    )

    expect(conflict).toMatchObject({
      ok: true,
      data: {
        syncEvent: {
          provider: "linear",
          localRecordId: "task_1",
          result: "conflict",
        },
      },
    })
    expect(resolved).toMatchObject({
      ok: true,
      data: {
        syncEvent: {
          provider: "linear",
          direction: "resolve",
          result: "resolved",
        },
      },
    })
    expect(repo.created).toHaveLength(2)
  })

  test("rejects non-JSON-serializable and oversized data", async () => {
    const nonSerializable = await runWithRepo(
      appendSyncEvent({
        direction: "pull",
        data: {
          result: "failed",
          providerId: "linear",
          error: {
            providerId: "linear",
            code: "unknown",
            retryable: false,
            message: "could not sync",
            details: { callback: () => undefined },
          },
        },
      })
    )

    expect(nonSerializable).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })

    const oversized = await runWithRepo(
      appendSyncEvent({
        direction: "pull",
        data: {
          result: "created",
          providerId: "linear",
          entityType: "task",
          entityId: "task_1",
          remoteId: "LIN-1",
          fields: ["x".repeat(1_048_576)],
        },
      })
    )

    expect(oversized).toMatchObject({
      ok: false,
      error: {
        code: "malformed_record",
      },
    })
  })

  test("is append-only and records every event through create", async () => {
    const first = await runWithRepo(
      appendSyncEvent({
        direction: "push",
        data: {
          result: "created",
          providerId: "linear",
          entityType: "task",
          entityId: "task_1",
          remoteId: "LIN-1",
          fields: ["title"],
        },
      })
    )
    const second = await runWithRepo(
      appendSyncEvent({
        direction: "push",
        data: {
          result: "updated",
          providerId: "linear",
          entityType: "task",
          entityId: "task_1",
          remoteId: "LIN-1",
          fields: ["description"],
        },
      })
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(repo.created).toHaveLength(2)
    expect(repo.created[0]?.id).not.toBe(repo.created[1]?.id)
  })

  test("lists events with filters sorted by createdAt then id", async () => {
    const first = makeEvent({
      id: "sync_event_00000000000000000000000000000002",
      createdAt: "2026-01-02T00:00:00.000Z",
      provider: "linear",
      direction: "push",
      result: "created",
      localRecordId: "task_1",
      remoteRecordId: "LIN-1",
    })
    const second = makeEvent({
      id: "sync_event_00000000000000000000000000000001",
      createdAt: "2026-01-01T00:00:00.000Z",
      provider: "linear",
      direction: "pull",
      result: "updated",
      localRecordId: "task_2",
      remoteRecordId: "LIN-2",
    })
    const third = makeEvent({
      id: "sync_event_00000000000000000000000000000003",
      createdAt: "2026-01-01T00:00:00.000Z",
      provider: "github",
      direction: "pull",
      result: "skipped",
      localRecordId: "task_3",
      remoteRecordId: "GH-3",
    })
    repo = new InMemorySyncEventRepository([first, second, third])

    const result = await runWithRepo(
      listSyncEvents({
        provider: "linear",
      })
    )

    expect(result).toEqual({
      ok: true,
      data: {
        syncEvents: [second, first],
        hasMore: false,
      },
    })
  })

  test("paginates at 500 with a continuation cursor and warning", async () => {
    repo = new InMemorySyncEventRepository(
      Array.from({ length: 501 }, (_, index) =>
        makeEvent({
          id: `sync_event_${index.toString().padStart(32, "0")}`,
          createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index).toISOString(),
          localRecordId: `task_${index}`,
          remoteRecordId: `LIN-${index}`,
        })
      )
    )

    const firstPage = await runWithRepo(listSyncEvents({}))

    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      throw new Error("expected first page to succeed")
    }

    expect(firstPage.data.syncEvents).toHaveLength(500)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.nextCursor).toEqual(expect.any(String))
    expect(firstPage.warnings).toEqual([
      {
        code: "result_truncated",
        message: "Sync event list exceeded the 500 item limit.",
        details: {
          limit: 500,
          hasMore: true,
          nextCursor: firstPage.data.nextCursor,
        },
      },
    ])

    const secondPage = await runWithRepo(listSyncEvents({ cursor: firstPage.data.nextCursor }))

    expect(secondPage).toMatchObject({
      ok: true,
      data: {
        syncEvents: [expect.objectContaining({ localRecordId: "task_500" })],
        hasMore: false,
      },
    })
  })

  test("maps repository failures to storage_error", async () => {
    repo.failCreate = { _tag: "storage_error", message: "write failed" }

    const result = await runWithRepo(
      appendSyncEvent({
        direction: "status",
        data: {
          result: "failed",
          providerId: "linear",
          error: {
            providerId: "linear",
            code: "network_error",
            retryable: true,
            message: "unreachable",
          },
        },
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
