import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import { LogbookLayer } from "@logbook/workspace/layers.js"
import { type CreateMcpServerOptions, createMcpServer } from "@logbook/workspace/mcp-server.js"

const entry = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")

describe("Task lifecycle through CLI and MCP", () => {
  let workspaceRoot: string

  const call = async (command: string, input: Record<string, unknown> = {}) => {
    const child = Bun.spawn([process.execPath, entry, command], {
      cwd: workspaceRoot,
      env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: workspaceRoot },
      stdin: new TextEncoder().encode(JSON.stringify(input)),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toBe("")
    const result = JSON.parse(stdout) as ToolResult<any>
    expect(exitCode).toBe(result.ok ? 0 : 1)
    return result
  }

  const succeed = async (command: string, input: Record<string, unknown> = {}) => {
    const result = await call(command, input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    return result.data
  }

  const createTask = (input: Record<string, unknown> = {}) =>
    succeed("task:create", {
      title: "Example task",
      description: "Disposable public API fixture",
      definitionOfDone: "Compatibility is explicit",
      project: "example",
      milestone: "v1",
      ...input,
    })

  const tasksFile = () => readFile(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), "utf8")

  const callMcp = async (name: string, input: Record<string, unknown>) => {
    const server = createMcpServer({
      workspaceRoot,
      layer: LogbookLayer(workspaceRoot) as unknown as CreateMcpServerOptions["layer"],
    })
    const result = await server.dispatch("tools/call", { name, arguments: input })
    const { content } = result as { content: Array<{ text: string }> }
    return JSON.parse(content[0]!.text) as ToolResult<any>
  }

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-lifecycle-"))
    await succeed("workspace:init", { path: workspaceRoot, migrateV1: false })
    const configPath = join(workspaceRoot, ".logbook/config.json")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    config.hooks.enabled = false
    await writeFile(configPath, JSON.stringify(config))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("CLI and MCP block/resume backlog, todo and review without fake execution", async () => {
    const { task: unrelated } = await createTask({ title: "Unrelated task" })
    for (const surface of ["cli", "mcp"] as const) {
      const { task } = await createTask()
      for (const status of ["backlog", "todo", "pending_review"] as const) {
        if (status === "todo") {
          await succeed("task:update", { id: task.id, newStatus: "todo" })
        } else if (status === "pending_review") {
          await succeed("task:update", { id: task.id, newStatus: "in_progress" })
          await succeed("task:update", { id: task.id, newStatus: "pending_review" })
        }
        const input = {
          id: task.id,
          newStatus: "blocked",
          comment: {
            content: `${surface}: prerequisite unavailable at ${status}`,
            kind: "regular",
          },
        }
        const blocked =
          surface === "cli" ? await call("task:update", input) : await callMcp("task.update", input)
        expect(blocked).toMatchObject({ ok: true, data: { task: { status: "blocked" } } })
        const persisted = (await succeed("task:get", { id: task.id })).task
        expect(persisted.inProgressSince).toBeUndefined()
        expect(persisted.comments.at(-1).content).toBe(input.comment.content)
        const resumeInput = { id: task.id, newStatus: status }
        expect(
          surface === "cli"
            ? await call("task:update", resumeInput)
            : await callMcp("task.update", resumeInput)
        ).toMatchObject({ ok: true, data: { task: { status } } })
        const resumed = (await succeed("task:get", { id: task.id })).task
        expect(resumed.inProgressSince).toBeUndefined()
        expect(resumed.comments).toEqual(persisted.comments)
      }
    }
    expect((await succeed("task:get", { id: unrelated.id })).task).toEqual(unrelated)
  }, 30_000)

  test("L2/L4: both public paths reject invalid blocker evidence without changing storage", async () => {
    const { task } = await createTask()
    const before = await tasksFile()
    for (const comment of [
      undefined,
      null,
      "Reason",
      { content: "", kind: "regular" },
      { content: "é".repeat(32_769), kind: "regular" },
      { content: "Reason", kind: "sync" },
      { content: "Reason", kind: "review" },
      { content: 123, kind: "regular" },
      { kind: "regular" },
    ]) {
      const input = { id: task.id, newStatus: "blocked", comment }
      expect(await call("task:update", input)).toMatchObject({
        ok: false,
        error: { code: "validation_error" },
      })
      expect(await tasksFile()).toBe(before)
      expect((await callMcp("task.update", input)).ok).toBe(false)
      expect(await tasksFile()).toBe(before)
    }
    const boundary = "é".repeat(32_768)
    await succeed("task:update", {
      id: task.id,
      newStatus: "blocked",
      comment: { content: boundary, kind: "need_info" },
    })
    const { task: blocked } = await succeed("task:get", { id: task.id })
    expect(blocked.comments[0].content).toBe(boundary)
    expect(
      await callMcp("task.update", {
        id: task.id,
        newStatus: "blocked",
        comment: { content: boundary, kind: "regular" },
      })
    ).toMatchObject({ ok: true })
    const after = await tasksFile()
    expect(
      await call("task:update", {
        id: task.id,
        newStatus: "blocked",
        comment: { content: "", kind: "regular" },
      })
    ).toMatchObject({ ok: false, error: { code: "validation_error" } })
    expect(await tasksFile()).toBe(after)
    await succeed("task:update", { id: task.id, newStatus: "in_progress" })
    const running = await tasksFile()
    expect(
      await call("task:update", {
        id: task.id,
        newStatus: "need_info",
        comment: { content: "Missing details", kind: "regular" },
      })
    ).toMatchObject({ ok: false, error: { code: "validation_error" } })
    expect(await tasksFile()).toBe(running)
    await succeed("task:update", {
      id: task.id,
      newStatus: "need_info",
      comment: { content: "Missing details", kind: "need_info" },
    })
  }, 30_000)

  test("malformed same-status comments retain validation errors through CLI and MCP", async () => {
    const { task } = await createTask()
    await createTask({ title: "Unrelated task" })
    const before = await tasksFile()
    for (const comment of [
      { content: "Evidence", title: 123 },
      { content: "Evidence", kind: "invalid" },
    ]) {
      const input = { id: task.id, newStatus: "backlog", comment }
      expect(await call("task:update", input)).toMatchObject({
        ok: false,
        error: {
          code: "validation_error",
          details: { filePath: join(workspaceRoot, ".logbook/storage/tasks.jsonl") },
        },
      })
      expect(await tasksFile()).toBe(before)
      expect(await callMcp("task.update", input)).toMatchObject({
        ok: false,
        error: { code: "schema_validation_error" },
      })
      expect(await tasksFile()).toBe(before)
    }
  })

  test("real write failures retain storage errors through CLI and MCP", async () => {
    const { task } = await createTask()
    await createTask({ title: "Unrelated task" })
    const before = await tasksFile()
    const storage = join(workspaceRoot, ".logbook/storage")
    await chmod(storage, 0o555)
    try {
      const input = {
        id: task.id,
        newStatus: "blocked",
        comment: { content: "Valid blocker" },
      }
      for (const surface of ["cli", "mcp"] as const) {
        const result =
          surface === "cli" ? await call("task:update", input) : await callMcp("task.update", input)
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "storage_error",
            message: "Atomic rewrite temp suffix attempts exhausted",
            details: { filePath: join(storage, "tasks.jsonl"), operation: "write" },
          },
        })
        expect(await tasksFile()).toBe(before)
        expect((await succeed("task:get", { id: task.id })).task).toEqual(task)
      }
    } finally {
      await chmod(storage, 0o755)
    }
  }, 15_000)

  test("same-status evidence persists while no-comment calls remain no-ops", async () => {
    const { task } = await createTask()
    await succeed("task:update", { id: task.id, newStatus: "todo" })
    const { task: running } = await succeed("task:update", {
      id: task.id,
      newStatus: "in_progress",
    })
    const before = await tasksFile()
    await succeed("task:update", { id: task.id, newStatus: "in_progress" })
    expect(await tasksFile()).toBe(before)
    for (const surface of ["cli", "mcp"] as const) {
      const input = {
        id: task.id,
        newStatus: "in_progress",
        comment: { content: `${surface}: new attempt evidence`, kind: "regular" },
      }
      expect(
        surface === "cli" ? await call("task:update", input) : await callMcp("task.update", input)
      ).toMatchObject({ ok: true })
    }
    const { task: persisted } = await succeed("task:get", { id: task.id })
    expect(persisted.comments.map((comment: { content: string }) => comment.content)).toEqual([
      "cli: new attempt evidence",
      "mcp: new attempt evidence",
    ])
    expect(persisted.inProgressSince).toBe(running.inProgressSince)
    expect(persisted.phaseModelOverrides).toEqual(running.phaseModelOverrides)
    const after = await tasksFile()
    for (const surface of ["cli", "mcp"] as const) {
      const input = {
        id: task.id,
        newStatus: "in_progress",
        comment: { content: "Reply", replyToCommentId: "missing-comment" },
      }
      expect(
        surface === "cli" ? await call("task:update", input) : await callMcp("task.update", input)
      ).toMatchObject({ ok: false, error: { code: "not_found" } })
      expect(await tasksFile()).toBe(after)
    }
  }, 20_000)

  test("forbidden transitions and missing tasks retain structured errors", async () => {
    const { task } = await createTask()
    const before = await tasksFile()
    for (const to of ["in_progress", "done", "pending_review"]) {
      expect(await call("task:update", { id: task.id, newStatus: to })).toMatchObject({
        ok: false,
        error: { code: "invalid_transition", details: { from: "backlog", to } },
      })
      expect(await tasksFile()).toBe(before)
    }
    const input = { id: "missing-task", newStatus: "blocked" }
    for (const surface of ["cli", "mcp"] as const) {
      expect(
        surface === "cli" ? await call("task:update", input) : await callMcp("task.update", input)
      ).toMatchObject({ ok: false, error: { code: "not_found" } })
      expect(await tasksFile()).toBe(before)
    }
  }, 15_000)

  test("terminal tasks cannot be blocked or resumed through either surface", async () => {
    for (const status of ["done", "canceled"] as const) {
      const { task } = await createTask()
      if (status === "done") {
        for (const newStatus of ["todo", "in_progress", "pending_review", "done"]) {
          await succeed("task:update", { id: task.id, newStatus })
        }
      } else {
        await succeed("task:update", { id: task.id, newStatus: status })
      }
      const before = await tasksFile()
      for (const newStatus of ["blocked", "backlog", "todo", "pending_review"]) {
        const input = { id: task.id, newStatus, comment: { content: "New reason" } }
        for (const surface of ["cli", "mcp"] as const) {
          expect(
            surface === "cli"
              ? await call("task:update", input)
              : await callMcp("task.update", input)
          ).toMatchObject({ ok: false, error: { code: "invalid_transition" } })
          expect(await tasksFile()).toBe(before)
        }
      }
    }
  }, 20_000)
})
