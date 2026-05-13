import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateV1Workspace } from "@logbook/workspace/migrate-v1.js"
import { Effect } from "effect"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const makeV1Task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-001",
  project: "myproject",
  milestone: "v1",
  title: "Fix the bug",
  description: "Detailed description here",
  definition_of_done: ["Bug is fixed and tested"],
  estimation: 3,
  comments: [],
  status: "backlog",
  priority: 0,
  ...overrides,
})

describe("migrate-v1", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("migrates v1 tasks.jsonl to v2 .logbook/storage/tasks.jsonl with camelCase fields", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-migrate-v1-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    const v1Task = makeV1Task({
      in_progress_since: "2026-01-01T00:00:00.000Z",
      assigned_model: "claude-sonnet-4-6",
    })
    await writeFile(join(workspaceRoot, "tasks.jsonl"), `${JSON.stringify(v1Task)}\n`, "utf8")

    const result = await run(migrateV1Workspace({ path: workspaceRoot }))
    expect(result).toMatchObject({ ok: true, data: { migrated: true, taskCount: 1 } })

    const migratedContent = await readFile(
      join(workspaceRoot, ".logbook/storage/tasks.jsonl"),
      "utf8"
    )
    const migratedLines = migratedContent.split("\n").filter((l) => l.trim().length > 0)
    expect(migratedLines).toHaveLength(1)

    const migratedTask = JSON.parse(migratedLines[0] ?? "{}") as Record<string, unknown>
    expect(migratedTask.kind).toBe("task")
    expect(migratedTask.id).toBe("task-001")
    expect(migratedTask.schemaVersion).toBe("2")
    expect(Object.hasOwn(migratedTask, "definition_of_done")).toBe(false)
    expect(Object.hasOwn(migratedTask, "definitionOfDone")).toBe(true)
  })

  test("skips migration when tasks.jsonl does not exist and returns migrated: false", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-migrate-v1-empty-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    const result = await run(migrateV1Workspace({ path: workspaceRoot }))
    expect(result).toMatchObject({ ok: true, data: { migrated: false, taskCount: 0 } })
  })

  test("preserves inProgressSince when migrating", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-migrate-v1-since-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    const v1Task = makeV1Task({
      status: "in_progress",
      in_progress_since: "2026-03-01T10:00:00.000Z",
    })
    await writeFile(join(workspaceRoot, "tasks.jsonl"), `${JSON.stringify(v1Task)}\n`, "utf8")

    const result = await run(migrateV1Workspace({ path: workspaceRoot }))
    expect(result.ok).toBe(true)

    const migratedContent = await readFile(
      join(workspaceRoot, ".logbook/storage/tasks.jsonl"),
      "utf8"
    )
    const migratedTask = JSON.parse(
      migratedContent.split("\n").filter((l) => l.trim().length > 0)[0] ?? "{}"
    ) as Record<string, unknown>
    expect(typeof migratedTask.inProgressSince).toBe("string")
    expect(migratedTask.inProgressSince).toContain("2026-03-01")
  })
})
