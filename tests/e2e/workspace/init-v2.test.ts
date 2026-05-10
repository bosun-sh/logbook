import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "@logbook/workspace/cli-adapter.js"
import { initWorkspace } from "@logbook/workspace/init.js"
import {
  ContextRepository,
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from "@logbook/workspace/repositories.js"
import { Effect } from "effect"

const storageFiles = [
  ".logbook/storage/epics.jsonl",
  ".logbook/storage/stories.jsonl",
  ".logbook/storage/tasks.jsonl",
  ".logbook/storage/context-entries.jsonl",
  ".logbook/storage/external-links.jsonl",
  ".logbook/storage/sync-events.jsonl",
  ".logbook/storage/sync-conflicts.jsonl",
] as const

let workspaceRoot: string | undefined

const makeWorkspace = async (name: string): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), name))
  return workspaceRoot
}

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, "utf8"))

const parseEnvelope = (stdout: string): any => {
  const lines = stdout.trim().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? "{}")
}

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

afterEach(async () => {
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("workspace.init", () => {
  test("creates the complete v2 workspace layout with contract defaults", async () => {
    const root = await makeWorkspace("logbook-task-27-init-")
    const result = await run(initWorkspace({ path: root }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        workspace: {
          path: root,
          schemaVersion: 2,
        },
        createdPaths: expect.arrayContaining([
          ".logbook/config.json",
          ".logbook/workspace.json",
          ".logbook/hooks/",
          ...storageFiles,
        ]),
      },
    })
    if (result.ok) {
      expect(Object.keys(result.data).sort()).toEqual(["createdPaths", "workspace"])
    }

    const config = await readJson(join(root, ".logbook/config.json"))
    expect(config).toEqual({
      schemaVersion: "2",
      storage: { root: ".logbook/storage" },
      hooks: {
        enabled: true,
        directory: ".logbook/hooks",
        defaultTimeoutMs: 5000,
        stdoutBytes: 1048576,
        stderrBytes: 1048576,
      },
    })

    const metadata = await readJson(join(root, ".logbook/workspace.json"))
    expect(metadata).toMatchObject({
      schemaVersion: "2",
      workspaceId: expect.stringMatching(/^workspace_[0-9a-f]{32}$/),
      logbookVersion: "2.0.0",
      storageRoot: ".logbook/storage",
    })
    expect(typeof metadata.createdAt).toBe("string")
    expect(metadata.updatedAt).toBe(metadata.createdAt)

    for (const storageFile of storageFiles) {
      await expect(readFile(join(root, storageFile), "utf8")).resolves.toBe("")
    }
    expect((await stat(join(root, ".logbook/hooks"))).isDirectory()).toBe(true)
  })

  test("is idempotent and preserves user-editable config plus existing JSONL contents", async () => {
    const root = await makeWorkspace("logbook-task-27-idempotent-")
    await run(initWorkspace({ path: root }))
    const customConfig = {
      schemaVersion: "2",
      workspaceName: "Edited by user",
      storage: { root: ".logbook/storage" },
      hooks: {
        enabled: false,
        directory: ".logbook/hooks",
        defaultTimeoutMs: 7500,
        stdoutBytes: 2048,
        stderrBytes: 4096,
      },
    }
    await writeFile(
      join(root, ".logbook/config.json"),
      `${JSON.stringify(customConfig, null, 2)}\n`,
      "utf8"
    )
    await writeFile(join(root, ".logbook/storage/tasks.jsonl"), '{"id":"kept"}\n', "utf8")

    const second = await run(initWorkspace({ path: root }))

    expect(second).toMatchObject({
      ok: true,
      data: {
        workspace: {
          path: root,
          schemaVersion: 2,
        },
        createdPaths: [],
      },
    })
    if (second.ok) {
      expect(Object.keys(second.data).sort()).toEqual(["createdPaths", "workspace"])
    }
    await expect(readJson(join(root, ".logbook/config.json"))).resolves.toEqual(customConfig)
    await expect(readFile(join(root, ".logbook/storage/tasks.jsonl"), "utf8")).resolves.toBe(
      '{"id":"kept"}\n'
    )
  })

  test("migrates root v1 tasks.jsonl during init and leaves the legacy file unchanged", async () => {
    const root = await makeWorkspace("logbook-task-28-migrate-")
    const legacyLine = JSON.stringify({
      id: "legacy-task",
      project: "migration",
      milestone: "m1",
      title: "Legacy task",
      description: "Import me.",
      definition_of_done: ["converted", "validated"],
      test_cases: ["readable from v2 storage"],
      assigned_session: "session-legacy",
      assigned_model: "gpt-5.3-codex",
      estimation: 5,
      predictedKTokens: 8,
      comments: [],
      status: "todo",
      priority: 2,
    })
    await writeFile(join(root, "tasks.jsonl"), `${legacyLine}\n`, "utf8")

    const result = await run(initWorkspace({ path: root, migrateV1: true }))

    expect(result).toMatchObject({
      ok: true,
      data: {
        workspace: {
          path: root,
          schemaVersion: 2,
        },
        createdPaths: expect.arrayContaining([".logbook/storage/tasks.jsonl"]),
        migrated: true,
      },
    })
    await expect(readFile(join(root, "tasks.jsonl"), "utf8")).resolves.toBe(`${legacyLine}\n`)

    const migratedLines = (await readFile(join(root, ".logbook/storage/tasks.jsonl"), "utf8"))
      .trim()
      .split("\n")
    expect(migratedLines).toHaveLength(1)
    expect(JSON.parse(migratedLines[0] ?? "{}")).toMatchObject({
      id: "legacy-task",
      kind: "task",
      schemaVersion: "2",
      definitionOfDone: "converted\nvalidated",
      definitionOfReady: "readable from v2 storage",
      sessionId: "session-legacy",
      model: { id: "gpt-5.3-codex" },
    })
  })

  test("blocks migration on invalid root JSONL and leaves canonical task storage empty", async () => {
    const root = await makeWorkspace("logbook-task-28-invalid-")
    await writeFile(join(root, "tasks.jsonl"), "{invalid-json\n", "utf8")

    const result = await run(initWorkspace({ path: root, migrateV1: true }))

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "malformed_record",
        details: {
          line: 1,
          filePath: join(root, "tasks.jsonl"),
        },
      },
    })
    await expect(readFile(join(root, ".logbook/storage/tasks.jsonl"), "utf8")).resolves.toBe("")
  })

  test("runs through the CLI alias and initialized repositories read missing JSONL as empty", async () => {
    const root = await makeWorkspace("logbook-task-27-cli-")
    let stdout = ""

    const exitCode = await runCli(["workspace:init"], {
      stdin: JSON.stringify({ path: root }),
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(parseEnvelope(stdout)).toMatchObject({
      ok: true,
      data: {
        workspace: {
          path: root,
          schemaVersion: 2,
        },
        createdPaths: expect.any(Array),
      },
    })

    await unlink(join(root, ".logbook/storage/tasks.jsonl"))
    await expect(
      run(new TaskRepository({ workspaceRoot: root, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new EpicRepository({ workspaceRoot: root, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new StoryRepository({ workspaceRoot: root, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new ContextRepository({ workspaceRoot: root, initialized: true }).list())
    ).resolves.toEqual([])
  })

  test("fails with workspace_error for incompatible paths and oversized config", async () => {
    const incompatibleRoot = await makeWorkspace("logbook-task-27-incompatible-")
    await mkdir(join(incompatibleRoot, ".logbook"), { recursive: true })
    await writeFile(join(incompatibleRoot, ".logbook/storage"), "not a directory", "utf8")

    await expect(run(initWorkspace({ path: incompatibleRoot }))).resolves.toMatchObject({
      ok: false,
      error: {
        code: "workspace_error",
      },
    })

    await rm(incompatibleRoot, { recursive: true, force: true })
    workspaceRoot = undefined

    const oversizedRoot = await makeWorkspace("logbook-task-27-oversized-")
    await mkdir(join(oversizedRoot, ".logbook"), { recursive: true })
    await writeFile(join(oversizedRoot, ".logbook/config.json"), "x".repeat(65_537), "utf8")

    await expect(run(initWorkspace({ path: oversizedRoot }))).resolves.toMatchObject({
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
