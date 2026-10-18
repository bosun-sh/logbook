import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import { LogbookLayer } from "@logbook/workspace/layers.js"
import { type CreateMcpServerOptions, createMcpServer } from "@logbook/workspace/mcp-server.js"

const entry = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")

// Characterize 2.1.0; docs/watch-compatibility.md specifies the successor's target outcomes.
describe("Watch public compatibility at eb8d3ba", () => {
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
      title: "Watch compatibility task",
      description: "Disposable public API fixture",
      definitionOfDone: "Compatibility is explicit",
      project: "watch",
      milestone: "S02",
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
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-watch-contract-"))
    await succeed("workspace:init", { path: workspaceRoot, migrateV1: false })
    const configPath = join(workspaceRoot, ".logbook/config.json")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    config.hooks.enabled = false
    await writeFile(configPath, JSON.stringify(config))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("L1: backlog, todo and pending_review cannot block directly; target persists blocked", async () => {
    const { task } = await createTask()
    for (const status of ["backlog", "todo", "in_progress", "pending_review"]) {
      if (status !== "backlog") {
        await succeed("task:update", { id: task.id, newStatus: status })
      }
      if (status === "in_progress") continue
      const before = await tasksFile()
      expect(
        await call("task:update", {
          id: task.id,
          newStatus: "blocked",
          comment: { content: "Required prerequisite is unavailable", kind: "regular" },
        })
      ).toMatchObject({
        ok: false,
        error: { code: "invalid_transition", details: { from: status, to: "blocked" } },
      })
      expect(await tasksFile()).toBe(before)
      expect((await succeed("task:get", { id: task.id })).task.status).toBe(status)
    }
  }, 20_000)

  test("L2: real execution can block with a reason; invalid reasons preserve storage", async () => {
    const { task } = await createTask()
    await succeed("task:update", { id: task.id, newStatus: "todo" })
    await succeed("task:update", { id: task.id, newStatus: "in_progress" })
    const before = await tasksFile()
    for (const comment of [undefined, { content: "x".repeat(65_537), kind: "regular" }]) {
      expect(
        await call("task:update", { id: task.id, newStatus: "blocked", comment })
      ).toMatchObject({
        ok: false,
        error: { code: "validation_error" },
      })
      expect(await tasksFile()).toBe(before)
    }
    await succeed("task:update", {
      id: task.id,
      newStatus: "blocked",
      comment: { content: "Missing required service", kind: "regular" },
    })
    const blocked = (await succeed("task:get", { id: task.id })).task
    expect(blocked.status).toBe("blocked")
    expect(blocked.inProgressSince).toBeUndefined()
    expect(blocked.comments).toHaveLength(1)
    expect(blocked.comments[0].content).toBe("Missing required service")
    expect(await call("task:update", { id: task.id, newStatus: "todo" })).toMatchObject({
      ok: false,
      error: { code: "invalid_transition" },
    })
    await succeed("task:update", { id: task.id, newStatus: "in_progress" })
  }, 20_000)

  test("L4: MCP rejects empty blocker evidence but the current CLI accepts it", async () => {
    const { task } = await createTask()
    await succeed("task:update", { id: task.id, newStatus: "todo" })
    await succeed("task:update", { id: task.id, newStatus: "in_progress" })
    const input = { id: task.id, newStatus: "blocked", comment: { content: "", kind: "regular" } }
    const before = await tasksFile()
    expect(await callMcp("task.update", input)).toMatchObject({
      ok: false,
      error: { code: "schema_validation_error" },
    })
    expect(await tasksFile()).toBe(before)
    const { task: blocked } = await succeed("task:update", input)
    expect(blocked.status).toBe("blocked")
    expect(blocked.comments[0].content).toBe("")
  }, 15_000)

  test("L3: same-status comments are discarded; target appends evidence without a transition", async () => {
    const { task } = await createTask()
    const before = await tasksFile()
    const { task: unchanged } = await succeed("task:update", {
      id: task.id,
      newStatus: "backlog",
      comment: { content: "New attempt evidence", kind: "regular" },
    })
    expect(unchanged.comments).toEqual([])
    expect(await tasksFile()).toBe(before)
    expect((await succeed("task:get", { id: task.id })).task.comments).toEqual([])
  }, 15_000)

  test("E1: estimate command rejects 65/128 although edit and storage accept 128", async () => {
    const { task } = await createTask()
    await succeed("task:estimate", { id: task.id, predictedKTokens: 64, complexity: "large" })
    for (const predictedKTokens of [65, 128]) {
      const before = await tasksFile()
      expect(
        await call("task:estimate", { id: task.id, predictedKTokens, complexity: "large" })
      ).toMatchObject({
        ok: false,
        error: { code: "validation_error", details: { maxPredictedKTokens: 64 } },
      })
      expect(await tasksFile()).toBe(before)
    }
    const estimate = {
      predictedKTokens: 128,
      complexity: "large",
      fibonacci: 21,
      confidence: "high",
    }
    await succeed("task:edit", { id: task.id, estimate })
    expect((await succeed("task:get", { id: task.id })).task.estimate).toEqual(estimate)
  }, 20_000)

  test("E2: command validation and zero default are distinct from Scrum effort", async () => {
    const { task } = await createTask()
    expect(task.estimate.predictedKTokens).toBe(0)
    const before = await tasksFile()
    for (const predictedKTokens of [0, -1, 1.5]) {
      expect(
        await call("task:estimate", { id: task.id, predictedKTokens, complexity: "small" })
      ).toMatchObject({ ok: false, error: { code: "validation_error" } })
      expect(await tasksFile()).toBe(before)
    }
    const { estimate } = await succeed("task:estimate", {
      predictedKTokens: 13,
      complexity: "small",
    })
    expect(estimate).toMatchObject({ predictedKTokens: 13, fibonacci: 13 })
    expect(task).not.toHaveProperty("storyPoints")
    expect(estimate).not.toHaveProperty("storyPoints")
  }, 15_000)

  test("H1: public creates persist reciprocal hierarchy and reject a mismatched epic", async () => {
    const { epic } = await succeed("epic:create", {
      title: "Watch epic",
      description: "Fixture",
      outcome: "Reliable hierarchy",
    })
    const { story } = await succeed("story:create", {
      epicId: epic.id,
      title: "Watch vertical",
      description: "Fixture",
      userValue: "Durable tasks",
    })
    const { task } = await createTask({ storyId: story.id })
    expect(task.epicId).toBe(epic.id)
    expect((await succeed("epic:get", { id: epic.id })).epic.storyIds).toEqual([story.id])
    expect((await succeed("story:get", { id: story.id })).story.taskIds).toEqual([task.id])
    const before = await tasksFile()
    expect(
      await call("task:create", {
        title: "Invalid parent",
        description: "Fixture",
        definitionOfDone: "Rejected",
        project: "watch",
        milestone: "S02",
        storyId: story.id,
        epicId: "other-epic",
      })
    ).toMatchObject({ ok: false, error: { code: "hierarchy_violation" } })
    expect(await tasksFile()).toBe(before)
    expect((await succeed("story:get", { id: story.id })).story.taskIds).toEqual([task.id])
    expect(await callMcp("task.edit", { id: task.id, storyId: "other-story" })).toMatchObject({
      ok: false,
      error: { code: "schema_validation_error" },
    })
    const { task: ignoredReparent } = await succeed("task:edit", {
      id: task.id,
      storyId: "other-story",
    })
    expect(ignoredReparent.storyId).toBe(story.id)
    expect((await succeed("story:get", { id: story.id })).story.taskIds).toEqual([task.id])
  }, 20_000)

  test("I1: CLI ignores operationId across restarts; MCP rejects it, target replays/conflicts", async () => {
    const operationId = "watch:create:1"
    const { task: first } = await createTask({ operationId })
    const { task: duplicate } = await createTask({ operationId })
    expect(first.id).not.toBe(duplicate.id)
    const { task: conflictingReuse } = await createTask({ operationId, title: "Different request" })
    expect(conflictingReuse.id).not.toBe(first.id)
    const before = await tasksFile()
    expect(
      await callMcp("task.create", {
        title: "Watch compatibility task",
        description: "Disposable public API fixture",
        definitionOfDone: "Compatibility is explicit",
        project: "watch",
        milestone: "S02",
        operationId,
      })
    ).toMatchObject({ ok: false, error: { code: "schema_validation_error" } })
    expect(await tasksFile()).toBe(before)
    const { items } = await succeed("task:list", { status: "*" })
    expect(items.map((item: { id: string }) => item.id).sort()).toEqual(
      [first.id, duplicate.id, conflictingReuse.id].sort()
    )
    expect(first).not.toHaveProperty("operationId")
  }, 15_000)

  test("I2: retrying a reply after a process exit duplicates its effect", async () => {
    const { task } = await createTask()
    const { task: commented } = await succeed("task:update", {
      id: task.id,
      newStatus: "todo",
      comment: { content: "Attempt evidence" },
    })
    const input = {
      id: task.id,
      newStatus: "todo",
      operationId: "watch:reply:1",
      comment: { content: "Reviewer evidence", replyToCommentId: commented.comments[0].id },
    }
    await succeed("task:update", input)
    await succeed("task:update", input)
    const { task: persisted } = await succeed("task:get", { id: task.id })
    const replies = persisted.comments[0].replies
    expect(replies).toHaveLength(2)
    expect(replies[0].id).not.toBe(replies[1].id)
    expect(replies.map((reply: { content: string }) => reply.content)).toEqual([
      "Reviewer evidence",
      "Reviewer evidence",
    ])
  }, 15_000)
})
