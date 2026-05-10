import { beforeEach, describe, expect, test } from "bun:test"
import type { ExternalLink } from "@logbook/context/schema.js"
import { pullLinearSync } from "@logbook/sync/linear/pull.js"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import type { Task } from "@logbook/task/schema.js"
import { Clock, Context, Effect, Layer } from "effect"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

type ExternalLinkRepositoryShape = {
  create(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
  get(id: string): Effect.Effect<ExternalLink, unknown>
  list(): Effect.Effect<readonly ExternalLink[], unknown>
  update(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
}

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

class InMemoryTaskRepository implements TaskRepositoryShape {
  readonly records = new Map<string, Task>()

  constructor(initialRecords: readonly Task[] = []) {
    for (const task of initialRecords) {
      this.records.set(task.id, task)
    }
  }

  findById(id: string) {
    const task = this.records.get(id)
    return task === undefined ? Effect.fail({ _tag: "not_found", id }) : Effect.succeed(task)
  }

  findByStatus(status: Task["status"] | "*") {
    const tasks = [...this.records.values()].filter(
      (task) => status === "*" || task.status === status
    )
    return Effect.succeed(tasks)
  }

  save(task: Task) {
    this.records.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task) {
    this.records.set(task.id, task)
    return Effect.succeed(undefined)
  }
}

class InMemoryExternalLinkRepository implements ExternalLinkRepositoryShape {
  readonly records = new Map<string, ExternalLink>()

  constructor(initialRecords: readonly ExternalLink[] = []) {
    for (const link of initialRecords) {
      this.records.set(link.id, link)
    }
  }

  create(link: ExternalLink) {
    this.records.set(link.id, link)
    return Effect.succeed(link)
  }

  get(id: string) {
    const link = this.records.get(id)
    return link === undefined ? Effect.fail({ _tag: "not_found", id }) : Effect.succeed(link)
  }

  list() {
    return Effect.succeed([...this.records.values()])
  }

  update(link: ExternalLink) {
    this.records.set(link.id, link)
    return Effect.succeed(link)
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

class InMemorySyncConflictRepository implements SyncConflictRepositoryShape {
  readonly records: SyncConflict[] = []

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
    this.records.splice(
      this.records.findIndex((record) => record.id === conflict.id),
      1,
      conflict
    )
    return Effect.succeed(conflict)
  }
}

const TaskRepositoryTag = Context.GenericTag<TaskRepositoryShape>("TaskRepository")
const ExternalLinkRepositoryTag =
  Context.GenericTag<ExternalLinkRepositoryShape>("ExternalLinkRepository")
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

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "local-v1",
  project: "Migration",
  milestone: "LOG",
  title: "Local title",
  description: "Local description",
  definitionOfDone: "Done",
  status: "todo",
  priority: 1,
  phaseModelOverrides: {},
  estimate: { predictedKTokens: 1, complexity: "small", fibonacci: 1, confidence: "low" },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

const makeLink = (overrides: Partial<ExternalLink> = {}): ExternalLink => ({
  id: "external_link_1",
  schemaVersion: "2",
  kind: "external_link",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provider: "linear",
  localRecord: { kind: "task", id: "task_1" },
  remoteRecord: { id: "issue_1", type: "issue" },
  lastSeenRemoteVersion: "remote-v1",
  lastPushedLocalVersion: "local-v1",
  ...overrides,
})

const fixtureIssue = {
  id: "issue_1",
  identifier: "LOG-1",
  url: "https://linear.app/acme/issue/LOG-1/test",
  title: "Remote title",
  description: "Remote description",
  priority: 2,
  updatedAt: "remote-v2",
  archivedAt: null,
  team: { id: "team_1", key: "LOG", name: "Logbook" },
  project: { id: "project_1", name: "Migration" },
  state: { id: "state_started", name: "Started", type: "started" },
  labels: { nodes: [] },
}

let taskRepo: InMemoryTaskRepository
let linkRepo: InMemoryExternalLinkRepository
let eventRepo: InMemorySyncEventRepository
let conflictRepo: InMemorySyncConflictRepository

const runPull = (
  client = LinearTransport.fixture([
    {
      name: "issues",
      request: { operationName: "LinearPullIssues" },
      response: {
        status: 200,
        body: {
          data: {
            issues: {
              nodes: [fixtureIssue],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    },
  ])
) =>
  Effect.runPromise(
    Effect.provide(
      Effect.withClock(fixedClock)(pullLinearSync({ dryRun: false })),
      Layer.mergeAll(
        Layer.succeed(TaskRepositoryTag, taskRepo),
        Layer.succeed(ExternalLinkRepositoryTag, linkRepo),
        Layer.succeed(SyncEventRepositoryTag, eventRepo),
        Layer.succeed(SyncConflictRepositoryTag, conflictRepo),
        Layer.succeed(LinearGraphQLClientTag, client)
      )
    ) as Effect.Effect<unknown, never>
  )

beforeEach(() => {
  taskRepo = new InMemoryTaskRepository()
  linkRepo = new InMemoryExternalLinkRepository()
  eventRepo = new InMemorySyncEventRepository()
  conflictRepo = new InMemorySyncConflictRepository()
})

describe("Linear pull sync", () => {
  test("imports an unmapped Linear issue as a task, external link, and created event", async () => {
    const result = await runPull()

    expect(result).toMatchObject({
      ok: true,
      data: {
        imported: 1,
        updated: 0,
        skipped: 0,
        conflicts: 0,
      },
    })
    expect(taskRepo.records.size).toBe(1)
    expect([...taskRepo.records.values()][0]).toMatchObject({
      title: "Remote title",
      status: "in_progress",
    })
    expect(linkRepo.records.size).toBe(1)
    expect(eventRepo.records[0]).toMatchObject({
      result: "created",
      remoteRecordId: "issue_1",
    })
  })

  test("creates a conflict instead of overwriting divergent local and remote changes", async () => {
    taskRepo = new InMemoryTaskRepository([makeTask({ updatedAt: "local-v2" })])
    linkRepo = new InMemoryExternalLinkRepository([makeLink()])

    const result = await runPull()

    expect(result).toMatchObject({
      ok: true,
      data: {
        imported: 0,
        updated: 0,
        conflicts: 1,
      },
    })
    expect(taskRepo.records.get("task_1")?.title).toBe("Local title")
    expect(conflictRepo.records).toHaveLength(1)
    expect(conflictRepo.records[0]).toMatchObject({
      provider: "linear",
      localRecord: { kind: "task", id: "task_1" },
      status: "open",
    })
    expect(eventRepo.records.some((event) => event.result === "conflict")).toBe(true)
  })
})
