import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExternalLink } from "@logbook/context/schema.js"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import type { Task } from "@logbook/task/schema.js"
import { type RunCliOptions, runCli } from "@logbook/workspace/cli-adapter.js"
import { Context, Effect, Layer } from "effect"

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

const makeLink = (): ExternalLink => ({
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
})

let taskRepo: InMemoryTaskRepository
let linkRepo: InMemoryExternalLinkRepository
let eventRepo: InMemorySyncEventRepository
let conflictRepo: InMemorySyncConflictRepository
let workspaceRoot: string | undefined
const originalCwd = process.cwd()
let linearClient: ReturnType<typeof LinearTransport.fixture>

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-linear-cli-"))
  await mkdir(join(workspaceRoot, ".logbook"), { recursive: true })
  await writeFile(
    join(workspaceRoot, ".logbook/config.json"),
    JSON.stringify(
      {
        schemaVersion: "2",
        linear: {
          apiTokenEnv: "LOGBOOK_LINEAR_CLI_TOKEN",
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
  process.env.LOGBOOK_LINEAR_CLI_TOKEN = "token"
  return workspaceRoot
}

const cleanupWorkspace = async () => {
  process.chdir(originalCwd)
  delete process.env.LOGBOOK_LINEAR_CLI_TOKEN
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
}

const layer = () =>
  Layer.mergeAll(
    Layer.succeed(TaskRepositoryTag, taskRepo),
    Layer.succeed(ExternalLinkRepositoryTag, linkRepo),
    Layer.succeed(SyncEventRepositoryTag, eventRepo),
    Layer.succeed(SyncConflictRepositoryTag, conflictRepo),
    Layer.succeed(LinearGraphQLClientTag, linearClient)
  )

beforeEach(() => {
  taskRepo = new InMemoryTaskRepository([makeTask()])
  linkRepo = new InMemoryExternalLinkRepository([makeLink()])
  eventRepo = new InMemorySyncEventRepository()
  conflictRepo = new InMemorySyncConflictRepository()
  linearClient = LinearTransport.fixture([
    {
      name: "health",
      request: { operationName: "LinearHealthCheck" },
      response: {
        status: 200,
        body: { data: { viewer: { id: "viewer_1" } } },
      },
    },
    {
      name: "get-issue",
      request: { operationName: "LinearGetIssue", variables: { id: "issue_1" } },
      response: {
        status: 200,
        body: {
          data: {
            issue: {
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
            },
          },
        },
      },
    },
  ])
})

afterEach(cleanupWorkspace)

describe("Linear CLI sync commands", () => {
  test("exposes sync:linear:setup through the CLI runtime", async () => {
    const root = await makeWorkspace()
    let stdout = ""

    const exitCode = await runCli(
      [
        "sync:linear:setup",
        "--workspace-id",
        "workspace_2",
        "--team-id",
        "team_2",
        "--api-token",
        "lin_api_test",
        "--write-env",
      ],
      {
        layer: layer() as unknown as RunCliOptions["layer"],
        stdout: (chunk) => {
          stdout += chunk
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout.trim())).toMatchObject({
      ok: true,
      data: {
        workspaceId: "workspace_2",
        defaultTeamId: "team_2",
        dotenv: { created: true },
      },
    })
    await expect(readFile(join(root, ".env"), "utf8")).resolves.toBe(
      "LINEAR_API_KEY=lin_api_test\n"
    )
    await expect(readFile(join(root, ".logbook/config.json"), "utf8")).resolves.toContain(
      '"defaultTeamId": "team_2"'
    )
  })

  test("exposes sync:linear:status and sync:linear:push through the CLI runtime", async () => {
    await makeWorkspace()
    let stdout = ""

    const statusExit = await runCli(["sync:linear:status"], {
      layer: layer() as unknown as RunCliOptions["layer"],
      stdin: JSON.stringify({ checkProvider: true }),
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(statusExit).toBe(0)
    expect(JSON.parse(stdout.trim())).toMatchObject({
      ok: true,
      data: {
        status: {
          configured: true,
          authenticated: true,
          reachable: true,
        },
      },
    })

    stdout = ""
    const pushExit = await runCli(["sync:linear:push"], {
      layer: layer() as unknown as RunCliOptions["layer"],
      stdin: JSON.stringify({ taskIds: ["task_1"], dryRun: true }),
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(pushExit).toBe(0)
    expect(JSON.parse(stdout.trim())).toMatchObject({
      ok: true,
      data: {
        skipped: 1,
        created: 0,
        updated: 0,
        conflicts: 0,
      },
    })
  })
})
