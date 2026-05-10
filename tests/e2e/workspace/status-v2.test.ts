import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "@logbook/workspace/cli-adapter.js"
import { initWorkspace } from "@logbook/workspace/init.js"
import { getWorkspaceStatus } from "@logbook/workspace/status.js"
import { Effect } from "effect"

let workspaceRoot: string | undefined

const makeWorkspace = async (name: string): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), name))
  return workspaceRoot
}

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const parseEnvelope = (stdout: string): any => {
  const lines = stdout.trim().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? "{}")
}

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, "utf8"))

const taskRecord = (id: string, status: string) => ({
  id,
  schemaVersion: "2",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  kind: "task",
  project: "logbook",
  milestone: "v2",
  title: `Task ${id}`,
  description: "Status fixture.",
  definitionOfDone: "Counted by workspace status.",
  status,
  priority: 1,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 1,
    complexity: "small",
    fibonacci: 1,
    confidence: "low",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
})

const writeTasks = async (root: string, records: readonly ReturnType<typeof taskRecord>[]) => {
  await writeFile(
    join(root, ".logbook/storage/tasks.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  )
}

afterEach(async () => {
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("workspace.status", () => {
  test("reports initialized workspace storage, task totals, hooks, providers, and CLI alias output", async () => {
    const root = await makeWorkspace("logbook-task-29-status-")
    await run(initWorkspace({ path: root }))
    await writeTasks(root, [taskRecord("task-1", "todo"), taskRecord("task-2", "canceled")])
    await writeFile(
      join(root, ".logbook/hooks/notify.json"),
      JSON.stringify({
        id: "notify",
        enabled: true,
        event: "task.status_changed",
        command: ["echo", "ok"],
      }),
      "utf8"
    )

    const result = await run(getWorkspaceStatus({ path: root }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          path: root,
          initialized: true,
          schemaVersion: 2,
          tasks: {
            total: 2,
            byStatus: {
              backlog: 0,
              todo: 1,
              in_progress: 0,
              need_info: 0,
              blocked: 0,
              pending_review: 0,
              done: 0,
              canceled: 1,
            },
          },
          storage: {
            canonicalFilesPresent: true,
            duckdbIndexPresent: false,
          },
          hooks: {
            configured: 1,
            enabled: 1,
          },
          providers: {},
        },
      },
    })

    let stdout = ""
    const exitCode = await runCli(["workspace:status"], {
      stdin: JSON.stringify({ path: root }),
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(parseEnvelope(stdout)).toMatchObject({
      ok: true,
      data: {
        status: {
          path: root,
          initialized: true,
          schemaVersion: 2,
          tasks: { total: 2 },
        },
      },
    })
  })

  test("fails when canonical storage files are missing", async () => {
    const root = await makeWorkspace("logbook-task-29-missing-storage-")
    await run(initWorkspace({ path: root }))
    await unlink(join(root, ".logbook/storage/tasks.jsonl"))

    await expect(run(getWorkspaceStatus({ path: root }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "storage_error",
        details: {
          missingPaths: [".logbook/storage/tasks.jsonl"],
        },
      },
    })
  })

  test("warns for configured Linear without a token and keeps canonical status ok", async () => {
    const root = await makeWorkspace("logbook-task-29-linear-")
    await run(initWorkspace({ path: root }))
    const configPath = join(root, ".logbook/config.json")
    const config = await readJson(configPath)
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          linear: {
            apiTokenEnv: "LOGBOOK_TASK_29_MISSING_TOKEN",
            statusMapping: {},
            labelMapping: {},
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const result = await run(getWorkspaceStatus({ path: root }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          providers: {
            linear: {
              configured: true,
              authenticated: false,
              pendingConflicts: 0,
            },
          },
        },
        warnings: [
          {
            code: "provider_warning",
            details: {
              provider: "linear",
              apiTokenEnv: "LOGBOOK_TASK_29_MISSING_TOKEN",
            },
          },
        ],
      },
    })
  })

  test("bounds hook config scanning at 200 files and returns a hasMore warning", async () => {
    const root = await makeWorkspace("logbook-task-29-hooks-bound-")
    await run(initWorkspace({ path: root }))
    await mkdir(join(root, ".logbook/hooks"), { recursive: true })
    for (let index = 0; index < 201; index += 1) {
      await writeFile(
        join(root, ".logbook/hooks", `${String(index).padStart(3, "0")}.json`),
        JSON.stringify({
          id: `hook-${index}`,
          enabled: index % 2 === 0,
          event: "task.status_changed",
          command: ["echo", String(index)],
        }),
        "utf8"
      )
    }

    const result = await run(getWorkspaceStatus({ path: root }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: {
          hooks: {
            configured: 200,
            enabled: 100,
          },
        },
        warnings: [
          {
            code: "has_more",
            details: {
              path: ".logbook/hooks/",
              hasMore: true,
              scanned: 200,
            },
          },
        ],
      },
    })
  })

  test("fails with workspace_error when workspace config exceeds the byte bound", async () => {
    const root = await makeWorkspace("logbook-task-29-config-bound-")
    await run(initWorkspace({ path: root }))
    await writeFile(join(root, ".logbook/config.json"), "x".repeat(65_537), "utf8")

    await expect(run(getWorkspaceStatus({ path: root }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "workspace_error",
        details: {
          maxBytes: 65536,
        },
      },
    })
  })
})
