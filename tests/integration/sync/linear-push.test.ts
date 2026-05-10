import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExternalLink } from "@logbook/context/schema.js"
import { pushLinearSync } from "@logbook/sync/linear/push.js"
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
    const index = this.records.findIndex((record) => record.id === conflict.id)
    if (index >= 0) {
      this.records.splice(index, 1, conflict)
    }
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

const issueRecord = {
  id: "issue_1",
  identifier: "LOG-1",
  url: "https://linear.app/acme/issue/LOG-1/test",
  title: "Local title",
  description: "Local description",
  priority: 1,
  updatedAt: "remote-v1",
  archivedAt: null,
  team: { id: "team_1", key: "LOG", name: "Logbook" },
  project: { id: "project_1", name: "Migration" },
  state: { id: "state_todo", name: "Todo", type: "unstarted" },
  labels: { nodes: [] },
}

let taskRepo: InMemoryTaskRepository
let linkRepo: InMemoryExternalLinkRepository
let eventRepo: InMemorySyncEventRepository
let conflictRepo: InMemorySyncConflictRepository
let workspaceRoot: string | undefined
const originalCwd = process.cwd()

const runWithLayers = (effect: Effect.Effect<unknown, unknown, unknown>) =>
  Effect.runPromise(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.mergeAll(
        Layer.succeed(TaskRepositoryTag, taskRepo),
        Layer.succeed(ExternalLinkRepositoryTag, linkRepo),
        Layer.succeed(SyncEventRepositoryTag, eventRepo),
        Layer.succeed(SyncConflictRepositoryTag, conflictRepo),
        Layer.succeed(LinearGraphQLClientTag, linearClient)
      )
    ) as Effect.Effect<unknown, never>
  )

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-linear-push-"))
  await mkdir(join(workspaceRoot, ".logbook"), { recursive: true })
  await writeFile(
    join(workspaceRoot, ".logbook/config.json"),
    JSON.stringify(
      {
        schemaVersion: "2",
        linear: {
          apiTokenEnv: "LOGBOOK_LINEAR_PUSH_TOKEN",
          defaultTeamId: "team_1",
          defaultProjectId: "project_1",
          statusMapping: {},
          labelMapping: {},
        },
      },
      null,
      2
    ),
    "utf8"
  )
  process.chdir(workspaceRoot)
  process.env.LOGBOOK_LINEAR_PUSH_TOKEN = "test-token"
  return workspaceRoot
}

const cleanupWorkspace = async () => {
  process.chdir(originalCwd)
  delete process.env.LOGBOOK_LINEAR_PUSH_TOKEN
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
}

let linearClient: ReturnType<typeof LinearTransport.fixture>

beforeEach(() => {
  taskRepo = new InMemoryTaskRepository()
  linkRepo = new InMemoryExternalLinkRepository()
  eventRepo = new InMemorySyncEventRepository()
  conflictRepo = new InMemorySyncConflictRepository()
  linearClient = LinearTransport.fixture([])
})

afterEach(cleanupWorkspace)

describe("Linear push sync", () => {
  test("creates a Linear issue and external link for an unlinked task when a default team is configured", async () => {
    await makeWorkspace()
    taskRepo = new InMemoryTaskRepository([makeTask({ comments: [] })])
    linearClient = LinearTransport.fixture([
      {
        name: "create-issue",
        request: {
          operationName: "LinearCreateIssue",
        },
        response: {
          status: 200,
          body: {
            data: {
              issueCreate: {
                issue: issueRecord,
              },
            },
          },
        },
      },
    ])

    const result = await runWithLayers(pushLinearSync({ dryRun: false }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        created: 1,
        updated: 0,
        skipped: 0,
        conflicts: 0,
      },
    })
    expect(linkRepo.records.size).toBe(1)
    expect(eventRepo.records[0]).toMatchObject({
      direction: "push",
      result: "created",
      provider: "linear",
    })
  })

  test("pushes local comments after updating a mapped issue when conflicts are clear", async () => {
    await makeWorkspace()
    taskRepo = new InMemoryTaskRepository([
      makeTask({
        updatedAt: "local-v2",
        comments: [
          {
            id: "comment_1",
            title: "Local note",
            content: "Local note content",
            kind: "regular",
            createdAt: "2026-01-02T00:00:00.000Z",
            replies: [],
          },
        ],
      }),
    ])
    linkRepo = new InMemoryExternalLinkRepository([makeLink()])
    linearClient = LinearTransport.fixture([
      {
        name: "get-issue",
        request: {
          operationName: "LinearGetIssue",
          variables: { id: "issue_1" },
        },
        response: {
          status: 200,
          body: {
            data: {
              issue: issueRecord,
            },
          },
        },
      },
      {
        name: "update-issue",
        request: {
          operationName: "LinearUpdateIssue",
          variables: {
            input: {
              id: "issue_1",
              title: "Local title",
              description: "Local description",
              teamId: "team_1",
              projectId: "project_1",
              priority: 1,
            },
          },
        },
        response: {
          status: 200,
          body: {
            data: {
              issueUpdate: {
                issue: {
                  ...issueRecord,
                  updatedAt: "remote-v2",
                },
              },
            },
          },
        },
      },
      {
        name: "create-comment",
        request: {
          operationName: "LinearCreateComment",
          variables: {
            issueId: "issue_1",
            body: "Local note content",
          },
        },
        response: {
          status: 200,
          body: {
            data: {
              commentCreate: {
                comment: {
                  id: "comment_remote_1",
                  createdAt: "2026-01-02T00:00:01.000Z",
                },
              },
            },
          },
        },
      },
    ])

    const result = await runWithLayers(pushLinearSync({ dryRun: false }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        created: 0,
        updated: 1,
        skipped: 0,
        conflicts: 0,
      },
    })
    expect(linkRepo.records.get("external_link_1")).toMatchObject({
      lastPushedLocalVersion: "local-v2",
      lastSeenRemoteVersion: "remote-v2",
    })
    expect(eventRepo.records[0]).toMatchObject({
      result: "updated",
      data: {
        result: "updated",
        providerId: "linear",
        entityType: "task",
        entityId: "task_1",
        remoteId: "issue_1",
      },
    })
  })

  test("skips unlinked tasks when the default team is missing", async () => {
    await makeWorkspace()
    const configPath = join(workspaceRoot!, ".logbook/config.json")
    await writeFile(
      configPath,
      JSON.stringify(
        {
          schemaVersion: "2",
          linear: {
            apiTokenEnv: "LOGBOOK_LINEAR_PUSH_TOKEN",
            statusMapping: {},
            labelMapping: {},
          },
        },
        null,
        2
      ),
      "utf8"
    )
    taskRepo = new InMemoryTaskRepository([makeTask()])

    const result = await runWithLayers(pushLinearSync({ dryRun: false }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        created: 0,
        updated: 0,
        skipped: 1,
        conflicts: 0,
      },
    })
    expect(eventRepo.records[0]).toMatchObject({
      data: {
        result: "skipped",
        providerId: "linear",
        reason: "missing_mapping",
      },
    })
  })

  test("creates a sync conflict instead of mutating when local and remote both changed", async () => {
    await makeWorkspace()
    taskRepo = new InMemoryTaskRepository([
      makeTask({
        updatedAt: "local-v2",
        title: "Changed title",
      }),
    ])
    linkRepo = new InMemoryExternalLinkRepository([
      makeLink({
        lastPushedLocalVersion: "local-v1",
        lastSeenRemoteVersion: "remote-v1",
      }),
    ])
    linearClient = LinearTransport.fixture([
      {
        name: "get-issue",
        request: {
          operationName: "LinearGetIssue",
          variables: { id: "issue_1" },
        },
        response: {
          status: 200,
          body: {
            data: {
              issue: {
                ...issueRecord,
                title: "Remote title",
                updatedAt: "remote-v2",
              },
            },
          },
        },
      },
    ])

    const result = await runWithLayers(pushLinearSync({ dryRun: false }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        created: 0,
        updated: 0,
        skipped: 0,
        conflicts: 1,
      },
    })
    expect(conflictRepo.records).toHaveLength(1)
    expect(eventRepo.records[0]).toMatchObject({
      data: {
        result: "conflict",
        providerId: "linear",
        entityType: "task",
        entityId: "task_1",
      },
    })
  })
})
