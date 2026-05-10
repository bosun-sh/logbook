import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDbIndex, rebuildDuckDbIndex } from "@logbook/workspace/duckdb-index.js"
import { Effect } from "effect"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const taskRecord = (id: string, title = id) => ({
  id,
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title,
  status: "todo",
})

const contextRecord = (id: string, body: string) => ({
  id,
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: id,
  body,
})

const writeJsonl = async (filePath: string, records: readonly unknown[]) => {
  await writeFile(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  )
}

describe("DuckDB index", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("queries canonical JSONL via real DuckDB read_json_auto without mutating storage", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-43-index-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    const tasksPath = join(workspaceRoot, ".logbook/storage/tasks.jsonl")
    const contextPath = join(workspaceRoot, ".logbook/storage/context-entries.jsonl")
    await writeJsonl(tasksPath, [taskRecord("task-1", "Build DuckDB index")])
    await writeJsonl(contextPath, [
      contextRecord("context-1", "DuckDB is optional and non-canonical"),
    ])
    const tasksBefore = await readFile(tasksPath, "utf8")
    const contextBefore = await readFile(contextPath, "utf8")

    const index = new DuckDbIndex({ workspaceRoot })
    const query = await run(index.query({ text: "duckdb" }))
    expect(query).toMatchObject({
      ok: true,
      data: {
        hasMore: false,
        items: expect.arrayContaining([
          expect.objectContaining({ id: "context-1", kind: "context_entry" }),
          expect.objectContaining({ id: "task-1", kind: "task" }),
        ]),
      },
    })

    await expect(readFile(tasksPath, "utf8")).resolves.toBe(tasksBefore)
    await expect(readFile(contextPath, "utf8")).resolves.toBe(contextBefore)
  })

  test("rebuild returns duckdb_in_memory implementation and does not write an index file", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-43-rebuild-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    await writeJsonl(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), [
      taskRecord("task-1", "Rebuildable query result"),
    ])

    const rebuild = await run(rebuildDuckDbIndex({ workspaceRoot }))
    expect(rebuild).toMatchObject({
      ok: true,
      data: {
        enabled: true,
        implementation: "duckdb_in_memory",
      },
    })

    const index = new DuckDbIndex({ workspaceRoot })
    const query = await run(index.query({ kind: "task", text: "rebuildable" }))
    expect(query).toMatchObject({
      ok: true,
      data: {
        items: [expect.objectContaining({ id: "task-1", kind: "task" })],
        hasMore: false,
      },
    })
  })

  test("works without DuckDB enabled and reports disabled index behavior", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-43-disabled-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    await writeJsonl(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), [taskRecord("task-1")])

    const index = new DuckDbIndex({ workspaceRoot, enabled: false })
    await expect(run(index.rebuild())).resolves.toMatchObject({
      ok: true,
      data: {
        enabled: false,
        implementation: "disabled",
        filesScanned: 0,
        recordsIndexed: 0,
        linesScanned: 0,
      },
      warnings: [
        {
          code: "index_disabled",
          message: "DuckDB index is disabled; canonical JSONL remains the source of truth.",
        },
      ],
    })
    await expect(run(index.query({}))).resolves.toMatchObject({
      ok: true,
      data: { items: [], hasMore: false },
      warnings: [{ code: "index_disabled" }],
    })
  })

  test("bounds query results to queryLimit and returns a hasMore warning", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-43-query-bound-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    await writeJsonl(
      join(workspaceRoot, ".logbook/storage/tasks.jsonl"),
      Array.from({ length: 6 }, (_, index) => taskRecord(`task-${index}`, "same query text"))
    )

    const index = new DuckDbIndex({ workspaceRoot, queryLimit: 5 })
    const result = await run(index.query({ text: "same query text" }))
    expect(result).toMatchObject({
      ok: true,
      data: {
        hasMore: true,
      },
      warnings: [
        {
          code: "has_more",
          message: "DuckDB index query returned the maximum 5 records.",
          details: {
            hasMore: true,
            limit: 5,
          },
        },
      ],
    })
    if (result.ok) {
      expect(result.data.items).toHaveLength(5)
    }
  })

  test("filters by kind using DuckDB SQL predicate", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-43-filter-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    await writeJsonl(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), [
      taskRecord("task-a"),
      taskRecord("task-b"),
    ])
    await writeJsonl(join(workspaceRoot, ".logbook/storage/context-entries.jsonl"), [
      contextRecord("ctx-1", "hello"),
    ])

    const index = new DuckDbIndex({ workspaceRoot })
    const result = await run(index.query({ kind: "task" }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.every((item) => item.kind === "task")).toBe(true)
      expect(result.data.items).toHaveLength(2)
    }
  })
})
