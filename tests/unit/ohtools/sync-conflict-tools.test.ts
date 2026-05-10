import { beforeEach, describe, expect, test } from "bun:test"
import { parseWithSchema } from "@bosun-sh/ohtools"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { syncConflictToolsPlugin } from "@logbook/plugin/sync-conflict-tools.js"
import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"
import { listSyncConflictsTool, resolveSyncConflictTool } from "@logbook/sync/conflict-tools.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

class InMemorySyncConflictRepository implements SyncConflictRepositoryShape {
  readonly records = new Map<string, SyncConflict>()

  constructor(initialRecords: readonly SyncConflict[] = []) {
    for (const record of initialRecords) {
      this.records.set(record.id, record)
    }
  }

  create(conflict: SyncConflict) {
    this.records.set(conflict.id, conflict)
    return Effect.succeed(conflict)
  }

  get(id: string) {
    const conflict = this.records.get(id)
    return conflict === undefined
      ? Effect.fail({ _tag: "not_found", message: `sync conflict ${id} was not found`, id })
      : Effect.succeed(conflict)
  }

  list() {
    return Effect.succeed([...this.records.values()])
  }

  update(conflict: SyncConflict) {
    this.records.set(conflict.id, conflict)
    return Effect.succeed(conflict)
  }
}

class InMemorySyncEventRepository implements SyncEventRepositoryShape {
  readonly records: SyncEvent[] = []

  create(event: SyncEvent) {
    this.records.push(event)
    return Effect.succeed(event)
  }

  list() {
    return Effect.succeed([...this.records])
  }
}

const SyncConflictRepositoryTag =
  Context.GenericTag<SyncConflictRepositoryShape>("SyncConflictRepository")
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

const runWithRepos = <A>(
  effect: Effect.Effect<
    A,
    unknown,
    SyncConflictRepositoryShape | SyncEventRepositoryShape | Clock.Clock
  >
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.merge(
        Layer.succeed(SyncConflictRepositoryTag, conflictRepo),
        Layer.succeed(SyncEventRepositoryTag, eventRepo)
      )
    )
  )

const makeConflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  id: "sync_conflict_0000000000000000000000000001",
  schemaVersion: "2",
  kind: "sync_conflict",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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
  status: "open",
  ...overrides,
})

let conflictRepo: InMemorySyncConflictRepository
let eventRepo: InMemorySyncEventRepository

beforeEach(() => {
  conflictRepo = new InMemorySyncConflictRepository([makeConflict()])
  eventRepo = new InMemorySyncEventRepository()
})

describe("sync conflict Ohtools surface", () => {
  test("registers sync conflict tools through the static registry", () => {
    const registered = registerLogbookTools()

    expect(syncConflictToolsPlugin.name).toBe("sync")
    expect(registered.toolIds.filter((id) => id.startsWith("sync.conflicts."))).toEqual([
      "sync.conflicts.list",
      "sync.conflicts.resolve",
    ])
    expect(registered.metadata.find((plugin) => plugin.id === "sync")).toMatchObject({
      id: "sync",
      toolIds: [
        "sync.conflicts.list",
        "sync.conflicts.resolve",
        "sync.linear.pull",
        "sync.linear.push",
        "sync.linear.status",
      ],
    })
  })

  test("defines object-rooted public schemas for conflict list and resolve", () => {
    expect(publicToolSchemas["sync.conflicts.list"].jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(publicToolSchemas["sync.conflicts.resolve"].jsonSchema).toMatchObject({
      type: "object",
      required: ["id", "resolution"],
      additionalProperties: false,
    })

    expect(
      parseWithSchema(
        publicToolSchemas["sync.conflicts.list"],
        {
          provider: "linear",
          status: "open",
          limit: 20,
        },
        ["sync.conflicts.list"]
      )
    ).toEqual({
      provider: "linear",
      status: "open",
      limit: 20,
    })
    expect(() =>
      parseWithSchema(
        publicToolSchemas["sync.conflicts.resolve"],
        {
          id: "sync_conflict_1",
          resolution: "manual",
          extra: true,
        },
        ["sync.conflicts.resolve"]
      )
    ).toThrow()
  })

  test("lists conflicts with the shared ToolResult envelope", async () => {
    const result = await runWithRepos(
      listSyncConflictsTool.run({ provider: "linear", status: "open" }, undefined as never) as never
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: "sync_conflict_0000000000000000000000000001",
            provider: "linear",
            status: "open",
          },
        ],
        hasMore: false,
      },
    })
  })

  test("requires manualRecord for manual conflict resolution", async () => {
    const result = await runWithRepos(
      resolveSyncConflictTool.run(
        {
          id: "sync_conflict_0000000000000000000000000001",
          resolution: "manual",
        },
        undefined as never
      ) as never
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
    expect(eventRepo.records).toHaveLength(0)
  })

  test("resolves a conflict and appends the resolution event", async () => {
    const result = await runWithRepos(
      resolveSyncConflictTool.run(
        {
          id: "sync_conflict_0000000000000000000000000001",
          resolution: "use_remote",
        },
        undefined as never
      ) as never
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        conflict: {
          id: "sync_conflict_0000000000000000000000000001",
          status: "resolved",
          resolution: "use_remote",
        },
        event: {
          provider: "linear",
          direction: "resolve",
          result: "resolved",
          data: {
            result: "resolved",
            providerId: "linear",
            conflictId: "sync_conflict_0000000000000000000000000001",
            resolution: "use_remote",
            fields: ["title"],
          },
        },
      },
    })
    expect(eventRepo.records).toHaveLength(1)
  })
})
