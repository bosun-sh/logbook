import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isError,
  isSuccess,
  type JsonRpcError,
  type JsonRpcSuccess,
  type ServerSession,
  spawnServer,
} from "../helpers/mcp-server-session.js"

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir = ""
let tasksFile = ""
let server: ServerSession | null = null

/** Returns the active server session; throws if setup() was not called. */
const getServer = (): ServerSession => {
  if (server === null) throw new Error("server not initialized — call setup() first")
  return server
}

const setup = async (): Promise<void> => {
  tmpDir = await mkdtemp(join(tmpdir(), "logbook-mcp-e2e-"))
  tasksFile = join(tmpDir, "tasks.jsonl")
  await writeFile(tasksFile, "", "utf8")
  server = spawnServer(tasksFile, join(tmpDir, "hooks-nonexistent"))
}

const teardown = async (): Promise<void> => {
  server?.kill()
  server = null
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  tmpDir = ""
  tasksFile = ""
}

// Minimal valid create_task params
const validCreateParams = {
  project: "test-project",
  milestone: "m1",
  title: "Test task",
  definition_of_done: "It works",
  description: "A task for testing",
  predictedKTokens: 1,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP server / JSON-RPC e2e", () => {
  afterEach(teardown)

  // -------------------------------------------------------------------------
  // 1. Unknown method
  // -------------------------------------------------------------------------
  test("unknown method → error code -32601", async () => {
    await setup()
    const res = await getServer().send({ jsonrpc: "2.0", id: 1, method: "unknown" })
    expect(isError(res)).toBe(true)
    expect((res as JsonRpcError).error.code).toBe(-32601)
  })

  // -------------------------------------------------------------------------
  // 2. Parse error
  // -------------------------------------------------------------------------
  test("malformed JSON → error code -32700", async () => {
    await setup()
    const res = await getServer().sendRaw("not json\n")
    expect(isError(res)).toBe(true)
    expect((res as JsonRpcError).error.code).toBe(-32700)
  })

  // -------------------------------------------------------------------------
  // 3. create_task — valid input
  // -------------------------------------------------------------------------
  test("create_task with valid params → task with id and status backlog", async () => {
    await setup()
    const res = await getServer().send({
      jsonrpc: "2.0",
      id: 3,
      method: "create_task",
      params: validCreateParams,
    })
    expect(isSuccess(res)).toBe(true)
    const result = (res as JsonRpcSuccess).result as { task: { id: string; status: string } }
    expect(typeof result.task.id).toBe("string")
    expect(result.task.status).toBe("backlog")
  })

  // -------------------------------------------------------------------------
  // 4. create_task — invalid params (missing required field)
  // -------------------------------------------------------------------------
  test("create_task with missing field → error code -32602", async () => {
    await setup()
    const res = await getServer().send({
      jsonrpc: "2.0",
      id: 4,
      method: "create_task",
      params: { project: "p", milestone: "m" }, // missing required fields
    })
    expect(isError(res)).toBe(true)
    expect((res as JsonRpcError).error.code).toBe(-32602)
  })

  // -------------------------------------------------------------------------
  // 5. list_tasks — returns created task with correct status filter
  // -------------------------------------------------------------------------
  test("list_tasks({ status: 'backlog' }) returns the created task", async () => {
    await setup()
    // Create a task first
    await getServer().send({
      jsonrpc: "2.0",
      id: 5,
      method: "create_task",
      params: validCreateParams,
    })
    const res = await getServer().send({
      jsonrpc: "2.0",
      id: 6,
      method: "list_tasks",
      params: { status: "backlog" },
    })
    expect(isSuccess(res)).toBe(true)
    const result = (res as JsonRpcSuccess).result as { tasks: unknown[] }
    expect(result.tasks.length).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // 6. list_tasks all
  // -------------------------------------------------------------------------
  test("list_tasks({ status: '*' }) returns all tasks", async () => {
    await setup()
    await getServer().send({
      jsonrpc: "2.0",
      id: 7,
      method: "create_task",
      params: validCreateParams,
    })
    await getServer().send({
      jsonrpc: "2.0",
      id: 8,
      method: "create_task",
      params: { ...validCreateParams, title: "Task 2" },
    })
    const res = await getServer().send({
      jsonrpc: "2.0",
      id: 9,
      method: "list_tasks",
      params: { status: "*" },
    })
    expect(isSuccess(res)).toBe(true)
    const result = (res as JsonRpcSuccess).result as { tasks: unknown[] }
    expect(result.tasks.length).toBeGreaterThanOrEqual(2)
  })

  // -------------------------------------------------------------------------
  // 7. current_task — fresh session with no in_progress task
  // -------------------------------------------------------------------------
  test("current_task on fresh session → error code -32006", async () => {
    await setup()
    const res = await getServer().send({ jsonrpc: "2.0", id: 10, method: "current_task" })
    expect(isError(res)).toBe(true)
    expect((res as JsonRpcError).error.code).toBe(-32006)
  })

  // -------------------------------------------------------------------------
  // 8. update_task — backlog → todo → in_progress
  // -------------------------------------------------------------------------
  test("update_task transitions status correctly", async () => {
    await setup()
    // Create
    const createRes = await getServer().send({
      jsonrpc: "2.0",
      id: 11,
      method: "create_task",
      params: validCreateParams,
    })
    expect(isSuccess(createRes)).toBe(true)
    const taskId = ((createRes as JsonRpcSuccess).result as { task: { id: string } }).task.id

    // Move to todo
    const toTodo = await getServer().send({
      jsonrpc: "2.0",
      id: 12,
      method: "update_task",
      params: { id: taskId, new_status: "todo" },
    })
    expect(isSuccess(toTodo)).toBe(true)
    expect((toTodo as JsonRpcSuccess).result).toEqual({ ok: true })

    // Move to in_progress
    const toInProgress = await getServer().send({
      jsonrpc: "2.0",
      id: 13,
      method: "update_task",
      params: { id: taskId, new_status: "in_progress" },
    })
    expect(isSuccess(toInProgress)).toBe(true)
    expect((toInProgress as JsonRpcSuccess).result).toEqual({ ok: true })

    // Verify via list_tasks
    const listRes = await getServer().send({
      jsonrpc: "2.0",
      id: 14,
      method: "list_tasks",
      params: { status: "in_progress" },
    })
    expect(isSuccess(listRes)).toBe(true)
    const tasks = ((listRes as JsonRpcSuccess).result as { tasks: Array<{ id: string }> }).tasks
    expect(tasks.some((t) => t.id === taskId)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 9. edit_task — update title
  // -------------------------------------------------------------------------
  test("edit_task updates the task title", async () => {
    await setup()
    const createRes = await getServer().send({
      jsonrpc: "2.0",
      id: 15,
      method: "create_task",
      params: validCreateParams,
    })
    expect(isSuccess(createRes)).toBe(true)
    const taskId = ((createRes as JsonRpcSuccess).result as { task: { id: string } }).task.id

    const editRes = await getServer().send({
      jsonrpc: "2.0",
      id: 16,
      method: "edit_task",
      params: { id: taskId, title: "Updated title" },
    })
    expect(isSuccess(editRes)).toBe(true)
    const result = (editRes as JsonRpcSuccess).result as { task: { title: string } }
    expect(result.task.title).toBe("Updated title")
  })

  // -------------------------------------------------------------------------
  // 10. update_task — unknown id → not_found error
  // -------------------------------------------------------------------------
  test("update_task with unknown id → error code -32001", async () => {
    await setup()
    const res = await getServer().send({
      jsonrpc: "2.0",
      id: 17,
      method: "update_task",
      params: { id: "nonexistent-id-xyz", new_status: "todo" },
    })
    expect(isError(res)).toBe(true)
    expect((res as JsonRpcError).error.code).toBe(-32001)
  })

  // -------------------------------------------------------------------------
  // 11. Orphan recovery — restarted agent reclaims the in_progress task
  // -------------------------------------------------------------------------
  test("orphan recovery: server B claims in_progress task from crashed server A", async () => {
    const orphanDir = await mkdtemp(join(tmpdir(), "logbook-orphan-"))
    const orphanTasksFile = join(orphanDir, "tasks.jsonl")
    const hooksDir = join(orphanDir, "hooks")
    await writeFile(orphanTasksFile, "", "utf8")

    const serverA = spawnServer(orphanTasksFile, hooksDir)

    // Create task and move it to in_progress on server A
    const createRes = await serverA.send({
      jsonrpc: "2.0",
      id: 1,
      method: "create_task",
      params: validCreateParams,
    })
    expect(isSuccess(createRes)).toBe(true)
    const taskId = ((createRes as JsonRpcSuccess).result as { task: { id: string } }).task.id

    await serverA.send({
      jsonrpc: "2.0",
      id: 2,
      method: "update_task",
      params: { id: taskId, new_status: "todo" },
    })
    await serverA.send({
      jsonrpc: "2.0",
      id: 3,
      method: "update_task",
      params: { id: taskId, new_status: "in_progress" },
    })

    // Simulate crash: hard-kill without stdin close so sessions.json retains the dead PID
    serverA.killHard()
    await serverA.exited

    // Spawn server B pointing at the same tasks file
    const serverB = spawnServer(orphanTasksFile, hooksDir)

    const res = await serverB.send({ jsonrpc: "2.0", id: 4, method: "current_task" })
    serverB.kill()

    await rm(orphanDir, { recursive: true, force: true })

    expect(isSuccess(res)).toBe(true)
    const result = (res as JsonRpcSuccess).result as {
      task: { id: string; assignee: { id: string } }
    }
    expect(result.task.id).toBe(taskId)
  })
})
