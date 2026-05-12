import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getLinearStatus } from "@logbook/sync/linear/status.js"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

class InMemorySyncEventRepository implements SyncEventRepositoryShape {
  readonly records: SyncEvent[] = []

  constructor(initialRecords: readonly SyncEvent[] = []) {
    this.records.push(...initialRecords)
  }

  create(event: SyncEvent) {
    this.records.push(event)
    return Effect.succeed(event)
  }

  list() {
    return Effect.succeed([...this.records])
  }
}

class InMemorySyncConflictRepository implements SyncConflictRepositoryShape {
  readonly records: SyncConflict[] = []

  constructor(initialRecords: readonly SyncConflict[] = []) {
    this.records.push(...initialRecords)
  }

  create(conflict: SyncConflict) {
    this.records.push(conflict)
    return Effect.succeed(conflict)
  }

  get(id: string) {
    const conflict = this.records.find((record) => record.id === id)
    return conflict === undefined
      ? Effect.fail({ _tag: "not_found", id })
      : Effect.succeed(conflict)
  }

  list() {
    return Effect.succeed([...this.records])
  }

  update(conflict: SyncConflict) {
    const index = this.records.findIndex((record) => record.id === conflict.id)
    if (index >= 0) {
      this.records.splice(index, 1, conflict)
    }
    return Effect.succeed(conflict)
  }
}

const SyncEventRepositoryTag = Context.GenericTag<SyncEventRepositoryShape>("SyncEventRepository")
const SyncConflictRepositoryTag =
  Context.GenericTag<SyncConflictRepositoryShape>("SyncConflictRepository")
const LinearGraphQLClientTag =
  Context.GenericTag<ReturnType<typeof LinearTransport.fixture>>("LinearGraphQLClient")

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-02T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-02T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const makeEvent = (overrides: Partial<SyncEvent> = {}): SyncEvent => ({
  id: "sync_event_1",
  schemaVersion: "2",
  kind: "sync_event",
  createdAt: "2026-01-02T12:00:00.000Z",
  updatedAt: "2026-01-02T12:00:00.000Z",
  provider: "linear",
  direction: "push",
  result: "updated",
  message: "Linear sync completed.",
  ...overrides,
})

const makeConflict = (overrides: Partial<SyncConflict> = {}): SyncConflict => ({
  id: "sync_conflict_1",
  schemaVersion: "2",
  kind: "sync_conflict",
  createdAt: "2026-01-02T11:00:00.000Z",
  updatedAt: "2026-01-02T11:00:00.000Z",
  provider: "linear",
  localRecord: { kind: "task", id: "task_1" },
  remoteRecord: { id: "issue_1", url: "https://linear.app/acme/issue/issue_1" },
  fields: [
    {
      path: "title",
      localValue: "Local title",
      remoteValue: "Remote title",
    },
  ],
  status: "open",
  ...overrides,
})

let eventRepo: InMemorySyncEventRepository
let conflictRepo: InMemorySyncConflictRepository
let workspaceRoot: string | undefined
const originalCwd = process.cwd()
let linearClient: ReturnType<typeof LinearTransport.fixture>

const runWithLayers = (effect: Effect.Effect<unknown, unknown, unknown>) =>
  Effect.runPromise(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.mergeAll(
        Layer.succeed(SyncEventRepositoryTag, eventRepo),
        Layer.succeed(SyncConflictRepositoryTag, conflictRepo),
        Layer.succeed(LinearGraphQLClientTag, linearClient)
      )
    ) as Effect.Effect<unknown, never>
  )

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-linear-status-"))
  await mkdir(join(workspaceRoot, ".logbook"), { recursive: true })
  await writeFile(
    join(workspaceRoot, ".logbook/config.json"),
    JSON.stringify(
      {
        schemaVersion: "2",
        linear: {
          apiTokenEnv: "LOGBOOK_LINEAR_STATUS_TOKEN",
          workspaceId: "workspace_1",
          defaultTeamId: "team_1",
          defaultProjectId: "project_1",
        },
      },
      null,
      2
    ),
    "utf8"
  )
  process.chdir(workspaceRoot)
  return workspaceRoot
}

afterEach(async () => {
  process.chdir(originalCwd)
  delete process.env.LOGBOOK_LINEAR_STATUS_TOKEN
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

beforeEach(() => {
  eventRepo = new InMemorySyncEventRepository([makeEvent()])
  conflictRepo = new InMemorySyncConflictRepository([makeConflict()])
  linearClient = LinearTransport.fixture([
    {
      name: "health",
      request: {
        operationName: "LinearHealthCheck",
      },
      response: {
        status: 200,
        body: {
          data: {
            viewer: { id: "viewer_1" },
          },
        },
      },
    },
  ])
})

describe("Linear status sync", () => {
  test("reports provider readiness, health, last sync, and open conflicts", async () => {
    await makeWorkspace()
    process.env.LOGBOOK_LINEAR_STATUS_TOKEN = "token"

    const result = await runWithLayers(getLinearStatus({ checkProvider: true }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          configured: true,
          authenticated: true,
          reachable: true,
          lastSyncAt: "2026-01-02T12:00:00.000Z",
          pendingConflicts: 1,
        },
      },
    })
  })

  test("warns when the Linear token is missing", async () => {
    await makeWorkspace()

    const result = await runWithLayers(getLinearStatus({ checkProvider: true }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          configured: true,
          authenticated: false,
          reachable: false,
          pendingConflicts: 1,
        },
        warnings: [
          {
            code: "provider_warning",
            details: {
              provider: "linear",
              apiTokenEnv: "LOGBOOK_LINEAR_STATUS_TOKEN",
            },
          },
        ],
      },
    })
  })

  test("loads the Linear token from local .env when the shell env is unset", async () => {
    const root = await makeWorkspace()
    await writeFile(join(root, ".env"), "LOGBOOK_LINEAR_STATUS_TOKEN=token\n", "utf8")

    const result = await runWithLayers(getLinearStatus({ checkProvider: true }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          configured: true,
          authenticated: true,
          reachable: true,
        },
      },
    })
  })
})
