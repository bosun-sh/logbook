import { afterEach, beforeEach, describe, expect, test } from "bun:test"
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

const validCreateParams = {
  project: "test-project",
  milestone: "m1",
  title: "Assignment test task",
  definition_of_done: ["It works"],
  test_cases: ["It does not regress"],
  description: "A task for assignment lifecycle testing",
  predictedKTokens: 1,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTask = async (server: ServerSession): Promise<string> => {
  const res = await server.send({
    jsonrpc: "2.0",
    id: 1,
    method: "create_task",
    params: validCreateParams,
  })
  expect(isSuccess(res)).toBe(true)
  return ((res as JsonRpcSuccess).result as { task: { id: string } }).task.id
}

const updateTask = async (
  server: ServerSession,
  id: string,
  new_status: string,
  reqId: number
): Promise<JsonRpcSuccess | JsonRpcError> => {
  return server.send({
    jsonrpc: "2.0",
    id: reqId,
    method: "update_task",
    params: { id, new_status },
  })
}

const listTasks = async (server: ServerSession, status: string): Promise<unknown[]> => {
  const res = await server.send({
    jsonrpc: "2.0",
    id: 99,
    method: "list_tasks",
    params: { status },
  })
  expect(isSuccess(res)).toBe(true)
  return ((res as JsonRpcSuccess).result as { tasks: unknown[] }).tasks
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("task assignment lifecycle / e2e", () => {
  // -------------------------------------------------------------------------
  // Test 1 — backlog and todo have no assignee
  // -------------------------------------------------------------------------
  describe("backlog and todo have no assignee", () => {
    let tmpDir = ""
    let server: ServerSession

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "logbook-assign-e2e-"))
      const tasksFile = join(tmpDir, "tasks.jsonl")
      await writeFile(tasksFile, "", "utf8")
      server = spawnServer(tasksFile, join(tmpDir, "hooks"))
    })

    afterEach(async () => {
      server.kill()
      await rm(tmpDir, { recursive: true, force: true })
    })

    test("create_task result has no assignee field", async () => {
      const res = await server.send({
        jsonrpc: "2.0",
        id: 1,
        method: "create_task",
        params: validCreateParams,
      })
      expect(isSuccess(res)).toBe(true)
      const task = ((res as JsonRpcSuccess).result as { task: Record<string, unknown> }).task
      expect(task.assignee).toBeUndefined()
      expect(task.assigned_session).toBeDefined()
      expect(task.assigned_model).toBeDefined()
    })

    test("task in todo has no assignee", async () => {
      const taskId = await createTask(server)
      await updateTask(server, taskId, "todo", 2)

      const tasks = await listTasks(server, "todo")
      const task = (tasks as Array<{ id: string; assignee?: unknown }>).find((t) => t.id === taskId)
      expect(task).toBeDefined()
      expect(task?.assignee).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Test 2 — in_progress sets assignee
  // -------------------------------------------------------------------------
  describe("in_progress sets assignee", () => {
    let tmpDir = ""
    let server: ServerSession

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "logbook-assign-e2e-"))
      const tasksFile = join(tmpDir, "tasks.jsonl")
      await writeFile(tasksFile, "", "utf8")
      server = spawnServer(tasksFile, join(tmpDir, "hooks"))
    })

    afterEach(async () => {
      server.kill()
      await rm(tmpDir, { recursive: true, force: true })
    })

    test("moving task to in_progress populates assignee with a non-empty id", async () => {
      const taskId = await createTask(server)
      await updateTask(server, taskId, "todo", 2)
      const inProgressRes = await updateTask(server, taskId, "in_progress", 3)
      expect(isSuccess(inProgressRes)).toBe(true)

      const tasks = await listTasks(server, "in_progress")
      const task = (tasks as Array<{ id: string; assignee?: { id: string } }>).find(
        (t) => t.id === taskId
      )
      expect(task).toBeDefined()
      expect(task?.assignee).toBeDefined()
      expect(typeof task?.assignee?.id).toBe("string")
      expect(task?.assignee?.id.length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // Test 3 — ownership enforcement: live session blocks, dead session allows
  // -------------------------------------------------------------------------
  describe("ownership enforcement", () => {
    let tmpDir = ""
    let serverA: ServerSession
    let serverB: ServerSession

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "logbook-assign-e2e-"))
      const tasksFile = join(tmpDir, "tasks.jsonl")
      await writeFile(tasksFile, "", "utf8")
      const hooksDir = join(tmpDir, "hooks")
      serverA = spawnServer(tasksFile, hooksDir)
      serverB = spawnServer(tasksFile, hooksDir)
    })

    afterEach(async () => {
      serverB.kill()
      await rm(tmpDir, { recursive: true, force: true })
    })

    test("live session blocks other session; dead session allows reassignment", async () => {
      // serverA claims the task
      const taskId = await createTask(serverA)
      await updateTask(serverA, taskId, "todo", 2)
      await updateTask(serverA, taskId, "in_progress", 3)

      const tasksA = await listTasks(serverA, "in_progress")
      const claimedTask = (tasksA as Array<{ id: string; assignee?: { id: string } }>).find(
        (t) => t.id === taskId
      )
      expect(claimedTask?.assignee).toBeDefined()
      const sessionAId = claimedTask?.assignee?.id

      // Move back to todo — serverA retains ownership
      await updateTask(serverA, taskId, "todo", 4)

      // serverB tries to claim — should be blocked while serverA is alive
      const blockedRes = await updateTask(serverB, taskId, "in_progress", 5)
      expect(isError(blockedRes)).toBe(true)
      expect((blockedRes as JsonRpcError).error.code).toBe(-32003)

      // Kill serverA (crash — no graceful deregistration)
      serverA.killHard()
      await serverA.exited

      // serverB retries — now it should succeed
      const claimRes = await updateTask(serverB, taskId, "in_progress", 6)
      expect(isSuccess(claimRes)).toBe(true)
      expect((claimRes as JsonRpcSuccess).result).toEqual({ ok: true })

      // Verify assignee changed to serverB's session
      const tasksB = await listTasks(serverB, "in_progress")
      const reassignedTask = (tasksB as Array<{ id: string; assignee?: { id: string } }>).find(
        (t) => t.id === taskId
      )
      expect(reassignedTask?.assignee).toBeDefined()
      expect(reassignedTask?.assignee?.id).not.toBe(sessionAId)
    })
  })
})
