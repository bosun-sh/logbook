import { beforeEach, describe, expect, test } from "bun:test"
import { createSyncConflict } from "@logbook/sync/conflicts.js"
import type { SyncConflict } from "@logbook/sync/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

class InMemorySyncConflictRepository implements SyncConflictRepositoryShape {
  readonly created: SyncConflict[] = []

  create(conflict: SyncConflict) {
    this.created.push(conflict)
    return Effect.succeed(conflict)
  }

  get(id: string) {
    const conflict = this.created.find((record) => record.id === id)
    return conflict === undefined
      ? Effect.fail({ _tag: "not_found", message: `sync conflict ${id} was not found`, id })
      : Effect.succeed(conflict)
  }

  list() {
    return Effect.succeed([...this.created])
  }

  update(conflict: SyncConflict) {
    this.created.splice(
      this.created.findIndex((record) => record.id === conflict.id),
      1,
      conflict
    )
    return Effect.succeed(conflict)
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

const conflictInput = {
  provider: "linear",
  localRecord: { kind: "task", id: "task_1" },
  remoteRecord: { id: "LIN-1", url: "https://linear.app/example/issue/LIN-1" },
} as const

let repo: InMemorySyncConflictRepository

beforeEach(() => {
  repo = new InMemorySyncConflictRepository()
})

describe("sync merge decisions", () => {
  test("creates an explicit conflict for divergent local and remote field changes", async () => {
    const result = await runWithRepo(
      createSyncConflict({
        ...conflictInput,
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

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected createSyncConflict to succeed")
    }

    const conflict = result.data.conflict
    if (conflict === undefined) {
      throw new Error("expected conflict payload")
    }

    expect(result.data.decision).toEqual({
      action: "conflict",
      fields: ["title"],
    })
    expect(conflict).toMatchObject({
      kind: "sync_conflict",
      provider: "linear",
      localRecord: { kind: "task", id: "task_1" },
      remoteRecord: { id: "LIN-1" },
      status: "open",
      fields: [
        {
          path: "title",
          baseValue: "Base title",
          localValue: "Local title",
          remoteValue: "Remote title",
        },
      ],
    })
    expect(result.data.event).toEqual({
      result: "conflict",
      providerId: "linear",
      conflictId: conflict.id,
      entityType: "task",
      entityId: "task_1",
      fields: ["title"],
    })
    expect(repo.created).toHaveLength(1)
  })

  test("accepts remote when local matches base and remote changed", async () => {
    const result = await runWithRepo(
      createSyncConflict({
        ...conflictInput,
        fields: [
          {
            path: "status",
            baseValue: "todo",
            localValue: "todo",
            remoteValue: "in_progress",
          },
        ],
      })
    )

    expect(result).toEqual({
      ok: true,
      data: {
        decision: {
          action: "accept_remote",
          fields: ["status"],
        },
      },
    })
    expect(repo.created).toHaveLength(0)
  })

  test("keeps local when remote matches base and local changed", async () => {
    const result = await runWithRepo(
      createSyncConflict({
        ...conflictInput,
        fields: [
          {
            path: "priority",
            baseValue: 1,
            localValue: 2,
            remoteValue: 1,
          },
        ],
      })
    )

    expect(result).toEqual({
      ok: true,
      data: {
        decision: {
          action: "keep_local",
          fields: ["priority"],
        },
      },
    })
    expect(repo.created).toHaveLength(0)
  })

  test("skips when both sides changed to the same value", async () => {
    const result = await runWithRepo(
      createSyncConflict({
        ...conflictInput,
        fields: [
          {
            path: "title",
            baseValue: "Base title",
            localValue: "Shared title",
            remoteValue: "Shared title",
          },
        ],
      })
    )

    expect(result).toEqual({
      ok: true,
      data: {
        decision: {
          action: "skip",
          fields: ["title"],
        },
      },
    })
    expect(repo.created).toHaveLength(0)
  })
})
