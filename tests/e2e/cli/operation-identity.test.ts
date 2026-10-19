import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"

const entry = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")
const fixture = join(import.meta.dir, "../../fixtures/operation-process.ts")
const taskInput = {
  title: "Task",
  description: "Fixture",
  definitionOfDone: "Verified",
  project: "example",
  milestone: "release",
}

describe("Durable operation identity through public CLI/MCP", () => {
  let root: string
  const start = (
    tool: string,
    input: Record<string, unknown>,
    stop = "",
    action = "",
    surface = "cli"
  ) =>
    Bun.spawn(
      [process.execPath, fixture, root, tool, JSON.stringify(input), stop, action, surface],
      { stdout: "pipe", stderr: "pipe" }
    )
  const collect = async (child: {
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    exited: Promise<number>
  }) => {
    const [out, err, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(err).toBe("")
    return { out, exit }
  }
  const call = async (tool: string, input: Record<string, unknown> = {}, surface = "cli") => {
    const { out } = await collect(start(tool, input, "", "", surface))
    return JSON.parse(out)
  }
  const succeed = async (tool: string, input: Record<string, unknown> = {}, surface = "cli") => {
    const result = await call(tool, input, surface)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result))
    return result.data
  }
  const canonical = async () =>
    Promise.all(
      ["epics", "stories", "tasks"].map((file) =>
        readFile(join(root, `.logbook/storage/${file}.jsonl`), "utf8")
      )
    )
  const hierarchy = async () => {
    const { epic } = await succeed("epic:create", {
      title: "Epic",
      description: "Fixture",
      outcome: "Reliable",
      operationId: "epic",
    })
    const { story } = await succeed("story:create", {
      epicId: epic.id,
      title: "Story",
      description: "Fixture",
      userValue: "Reliable",
      operationId: "story",
    })
    expect(
      (
        await succeed(
          "epic:create",
          {
            title: "Epic",
            description: "Fixture",
            outcome: "Reliable",
            operationId: "epic",
          },
          "mcp"
        )
      ).epic
    ).toEqual(epic)
    return { epic, story }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "logbook-operation-"))
    const child = Bun.spawn([process.execPath, entry, "workspace:init"], {
      cwd: root,
      env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: root },
      stdin: new TextEncoder().encode(JSON.stringify({ path: root, migrateV1: false })),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect((await collect(child)).exit).toBe(0)
    const configPath = join(root, ".logbook/config.json")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    config.hooks.enabled = false
    await writeFile(configPath, JSON.stringify(config))
  })
  afterEach(async () => {
    await chmod(join(root, ".logbook/storage"), 0o755)
    await rm(root, { recursive: true, force: true })
  })

  for (const surface of ["cli", "mcp"]) {
    test(`${surface} identified empty edit preserves canonical bytes and replays its original result after a later edit`, async () => {
      const { task } = await succeed("task:create", taskInput, surface)
      const before = await canonical()
      expect((await succeed("task:edit", { id: task.id }, surface)).task).toEqual(task)
      expect(await canonical()).toEqual(before)

      const input = { id: task.id, operationId: "empty-edit" }
      const original = await succeed("task:edit", input, surface)
      expect(original.task).toEqual(task)
      expect(original.task.updatedAt).toBe(task.updatedAt)
      expect(original.receipt).toEqual({
        operationId: input.operationId,
        tool: "task.edit",
        affectedEntityIds: [],
        outcome: "applied",
      })
      expect(await canonical()).toEqual(before)

      await succeed(
        "task:edit",
        { id: task.id, title: "Later edit", operationId: "later" },
        surface
      )
      const after = await canonical()
      for (const retrySurface of ["cli", "mcp"]) {
        expect(await succeed("task:edit", input, retrySurface)).toEqual({
          ...original,
          receipt: { ...original.receipt, outcome: "replayed" },
        })
        expect(
          await succeed("operation:get", { operationId: input.operationId }, retrySurface)
        ).toEqual({
          state: "committed",
          receipt: { ...original.receipt, outcome: "replayed" },
          result: { ok: true, data: { task } },
        })
        expect(
          await call("task:edit", { ...input, title: "Conflict" }, retrySurface)
        ).toMatchObject({
          ok: false,
          error: { code: "operation_conflict" },
        })
        expect(await canonical()).toEqual(after)
      }
    }, 20_000)
  }

  test("six mutations replay original IDs/results after later edits; semantic key order and tool conflicts", async () => {
    const { epic, story } = await hierarchy()
    const input = { ...taskInput, storyId: story.id, operationId: "task" }
    const created = await succeed("task:create", input)
    expect(created.receipt).toMatchObject({
      operationId: "task",
      tool: "task.create",
      outcome: "applied",
    })
    expect(created.receipt.affectedEntityIds.sort()).toEqual([created.task.id, story.id].sort())
    const mutations: [string, Record<string, unknown>][] = [
      ["task:edit", { id: created.task.id, title: "Edited", operationId: "edit" }],
      [
        "task:estimate",
        {
          id: created.task.id,
          predictedKTokens: 32,
          complexity: "large",
          operationId: "estimate",
        },
      ],
      [
        "task:update",
        {
          id: created.task.id,
          newStatus: "todo",
          comment: { content: "Ready evidence" },
          operationId: "ready",
        },
      ],
    ]
    for (const [tool, payload] of mutations) {
      const original = await succeed(tool, payload, "mcp")
      const again = await succeed(tool, Object.fromEntries(Object.entries(payload).reverse()))
      expect(again).toEqual({ ...original, receipt: { ...original.receipt, outcome: "replayed" } })
    }
    const before = await canonical()
    expect((await succeed("task:create", input, "mcp")).task).toEqual(created.task)
    expect((await succeed("operation:get", { operationId: "task" })).result.data.task).toEqual(
      created.task
    )
    expect(
      await call("task:edit", { id: created.task.id, title: "Other", operationId: "task" })
    ).toMatchObject({ ok: false, error: { code: "operation_conflict" } })
    expect(await call("task:create", { ...input, storyId: "other" }, "mcp")).toMatchObject({
      ok: false,
      error: { code: "operation_conflict" },
    })
    expect(await canonical()).toEqual(before)
    expect((await succeed("epic:get", { id: epic.id })).epic.storyIds).toEqual([story.id])
    expect((await succeed("story:get", { id: story.id })).story.taskIds).toEqual([created.task.id])
    expect((await succeed("operation:get", { operationId: "missing" }, "mcp")).state).toBe("absent")
  }, 30_000)

  test("interrupted status/comment and reply writes preserve their original timestamps and IDs", async () => {
    const { task } = await succeed("task:create", taskInput)
    const status = {
      id: task.id,
      newStatus: "todo",
      comment: { content: "Evidence" },
      operationId: "status",
    }
    await collect(start("task:update", status, "canonical:tasks.jsonl", "kill"))
    const persisted = (await succeed("task:get", { id: task.id })).task
    const recovered = await succeed("task:update", status, "mcp")
    expect(recovered.task).toEqual(persisted)
    const reply = {
      id: task.id,
      newStatus: "todo",
      comment: { content: "Reply", replyToCommentId: persisted.comments[0].id },
      operationId: "reply",
    }
    await collect(start("task:update", reply, "canonical:tasks.jsonl", "kill"))
    const replied = (await succeed("task:get", { id: task.id })).task
    expect((await succeed("task:update", reply)).task).toEqual(replied)
    expect(replied.comments[0].replies).toHaveLength(1)
    await succeed("task:edit", { id: task.id, title: "Later mutation", operationId: "later" })
    const before = await canonical()
    expect((await succeed("task:update", status)).task).toEqual(persisted)
    expect((await succeed("task:update", reply, "mcp")).task).toEqual(replied)
    expect(await canonical()).toEqual(before)
  }, 20_000)

  test("validation, parent failures and malformed storage preserve original errors without effects", async () => {
    const before = await canonical()
    for (const operationId of ["", "   ", 17, null, "x".repeat(257)]) {
      for (const surface of ["cli", "mcp"])
        expect(await call("task:create", { ...taskInput, operationId }, surface)).toMatchObject({
          ok: false,
          error: { code: "schema_validation_error" },
        })
    }
    expect(
      await call("task:create", { ...taskInput, storyId: "missing", operationId: "bad-parent" })
    ).toMatchObject({ ok: false, error: { code: "not_found" } })
    expect(
      await call("task:estimate", {
        predictedKTokens: 32,
        complexity: "large",
        operationId: "no-task",
      })
    ).toMatchObject({ ok: false, error: { code: "validation_error" } })
    expect(await canonical()).toEqual(before)
    expect((await succeed("operation:get", { operationId: "bad-parent" })).state).toBe("absent")
    await writeFile(join(root, ".logbook/storage/tasks.jsonl"), "broken-json\n")
    expect(await call("task:create", { ...taskInput, operationId: "malformed" })).toMatchObject({
      ok: false,
      error: { code: "malformed_record" },
    })
    expect(
      await call("task:edit", { id: "missing", title: "Changed", operationId: "bad-read" })
    ).toMatchObject({ ok: false, error: { code: "malformed_record" } })
    for (const [tool, payload] of [
      ["task:update", { id: "missing", newStatus: "todo" }],
      ["task:estimate", { id: "missing", predictedKTokens: 32, complexity: "large" }],
    ] as const) {
      expect(await call(tool, { ...payload, operationId: tool }, "mcp")).toMatchObject({
        ok: false,
        error: { code: "malformed_record" },
      })
      expect((await succeed("operation:get", { operationId: tool })).state).toBe("absent")
    }
    expect(await readFile(join(root, ".logbook/storage/tasks.jsonl"), "utf8")).toBe("broken-json\n")
  }, 30_000)

  for (const tool of ["story:create", "task:create"]) {
    for (const stop of ["before-intent", "intent", "child", "parent", "committed"]) {
      test(`${tool}: SIGKILL at ${stop} recovers the original child and reciprocal link`, async () => {
        const { epic, story } = await hierarchy()
        const input =
          tool === "story:create"
            ? {
                epicId: epic.id,
                title: "Interrupted",
                description: "Fixture",
                userValue: "Recovery",
                operationId: "crash",
              }
            : { ...taskInput, storyId: story.id, operationId: "crash" }
        const childFile = tool === "story:create" ? "stories" : "tasks"
        const parentFile = tool === "story:create" ? "epics" : "stories"
        const point =
          stop === "child"
            ? `canonical:${childFile}.jsonl`
            : stop === "parent"
              ? `canonical:${parentFile}.jsonl`
              : stop
        const before = await canonical()
        const crashed = await collect(start(tool, input, point, "kill"))
        expect(crashed.exit).not.toBe(0)
        expect(crashed.out).toBe("")
        const lookup = await succeed("operation:get", { operationId: "crash" }, "mcp")
        expect(lookup.state).toBe(
          stop === "before-intent" ? "absent" : stop === "committed" ? "committed" : "uncertain"
        )
        if (stop === "intent" || stop === "before-intent") expect(await canonical()).toEqual(before)
        const completed = await succeed(tool, input)
        const entity = completed.story ?? completed.task
        if (stop !== "before-intent")
          expect(lookup.affectedEntityIds ?? lookup.receipt.affectedEntityIds).toContain(entity.id)
        expect(await succeed(tool, input, "mcp")).toEqual({
          ...completed,
          receipt: { ...completed.receipt, outcome: "replayed" },
        })
        const parent = await succeed(tool === "story:create" ? "epic:get" : "story:get", {
          id: tool === "story:create" ? epic.id : story.id,
        })
        const links = parent.epic?.storyIds ?? parent.story.taskIds
        expect(links.filter((id: string) => id === entity.id)).toHaveLength(1)
        expect((await succeed("operation:get", { operationId: "crash" })).state).toBe("committed")
      }, 20_000)
    }
  }

  test("pending operation blocks new identities; drift is explicit and lookup never completes writes", async () => {
    const input = { ...taskInput, operationId: "crash" }
    await collect(start("task:create", input, "canonical:tasks.jsonl", "kill"))
    const before = await canonical()
    expect(await call("task:create", { ...taskInput, operationId: "another" })).toMatchObject({
      ok: false,
      error: { code: "operation_uncertain", details: { operationId: "crash" } },
    })
    await succeed("operation:get", { operationId: "crash" })
    expect(await canonical()).toEqual(before)
    // Deliberate unsupported legacy writer: recovery must preserve its drift, not overwrite it.
    await succeed("task:create", { ...taskInput, title: "Other writer" })
    const drift = await canonical()
    expect(await call("task:create", input)).toMatchObject({
      ok: false,
      error: { code: "operation_uncertain" },
    })
    expect(await canonical()).toEqual(drift)
  }, 15_000)

  test("real canonical write failure retains intent and safely retries after storage recovery", async () => {
    const input = { ...taskInput, operationId: "readonly" }
    const before = await canonical()
    const failed = JSON.parse(
      (await collect(start("task:create", input, "intent", "readonly"))).out
    )
    expect(failed).toMatchObject({ ok: false, error: { code: "operation_uncertain" } })
    expect(failed.error.details.cause).toContain("EACCES")
    expect(await canonical()).toEqual(before)
    await chmod(join(root, ".logbook/storage"), 0o755)
    expect((await succeed("operation:get", { operationId: "readonly" })).state).toBe("uncertain")
    expect((await succeed("task:create", input)).receipt.outcome).toBe("replayed")
  }, 15_000)

  test("native lock rejects concurrent process writers and releases on SIGKILL", async () => {
    const input = { ...taskInput, operationId: "concurrent" }
    const child = start("task:create", input, "intent", "hold")
    try {
      const reader = child.stdout.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("locked\n")
      reader.releaseLock()
      expect(await call("task:create", input)).toMatchObject({
        ok: false,
        error: { code: "writer_conflict" },
      })
      child.kill("SIGKILL")
      await child.exited
      const result = await succeed("task:create", input)
      expect(result.receipt.outcome).toBe("replayed")
      expect((await succeed("task:list", { status: "*" })).items).toHaveLength(1)
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }
  }, 15_000)

  test("legacy entities and journal survive consistent backup/restore; unsupported version fails closed", async () => {
    const legacy = await succeed("task:create", taskInput)
    const identified = await succeed("task:create", { ...taskInput, operationId: "backup" })
    const before = await canonical()
    const backup = join(root, "backup")
    await cp(join(root, ".logbook"), backup, { recursive: true })
    await succeed("task:edit", { id: legacy.task.id, title: "Newer" })
    await rm(join(root, ".logbook"), { recursive: true })
    await cp(backup, join(root, ".logbook"), { recursive: true })
    expect(await canonical()).toEqual(before)
    expect((await succeed("task:create", { ...taskInput, operationId: "backup" })).task).toEqual(
      identified.task
    )
    const db = await DuckDBInstance.create(join(root, ".logbook/operations.duckdb"))
    const conn = await db.connect()
    try {
      const row = (
        await conn.runAndReadAll("SELECT record FROM operations WHERE id='backup'")
      ).getRowObjects()[0]!
      const record = JSON.parse(String(row.record))
      record.version = 2
      await conn.run("UPDATE operations SET record=? WHERE id='backup'", [JSON.stringify(record)])
    } finally {
      conn.closeSync()
      db.closeSync()
    }
    expect(await call("task:create", { ...taskInput, operationId: "backup" })).toMatchObject({
      ok: false,
      error: { code: "storage_error" },
    })
    expect(await canonical()).toEqual(before)
    const future = await DuckDBInstance.create(join(root, ".logbook/operations.duckdb"))
    const futureConn = await future.connect()
    try {
      await futureConn.run("UPDATE operation_format SET version=2")
    } finally {
      futureConn.closeSync()
      future.closeSync()
    }
    expect(await call("task:create", { ...taskInput, operationId: "new-version" })).toMatchObject({
      ok: false,
      error: { code: "operation_version_unsupported" },
    })
    expect(await call("operation:get", { operationId: "backup" })).toMatchObject({
      ok: false,
      error: { code: "operation_version_unsupported" },
    })
    expect(await canonical()).toEqual(before)
  }, 20_000)
})
