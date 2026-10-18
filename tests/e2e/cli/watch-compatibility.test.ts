import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import { LogbookLayer } from "@logbook/workspace/layers.js"
import { type CreateMcpServerOptions, createMcpServer } from "@logbook/workspace/mcp-server.js"

const entry = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")

// Public T02 lifecycle/estimate and T03 identity contracts; all workspaces are disposable.
describe("Watch public compatibility", () => {
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

  test("L1: CLI and MCP block/resume backlog, todo and review without fake execution", async () => {
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

  test("L3: malformed same-status comments retain validation errors through CLI and MCP", async () => {
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

  test("L/E: real write failures retain storage errors through CLI and MCP", async () => {
    const { task } = await createTask()
    await createTask({ title: "Unrelated task" })
    const before = await tasksFile()
    const storage = join(workspaceRoot, ".logbook/storage")
    await chmod(storage, 0o555)
    try {
      for (const [command, input] of [
        [
          "task:update",
          { id: task.id, newStatus: "blocked", comment: { content: "Valid blocker" } },
        ],
        ["task:estimate", { id: task.id, predictedKTokens: 128, complexity: "large" }],
      ] as const) {
        for (const surface of ["cli", "mcp"] as const) {
          const result =
            surface === "cli"
              ? await call(command, input)
              : await callMcp(command.replace(":", "."), input)
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
      }
    } finally {
      await chmod(storage, 0o755)
    }
  }, 15_000)

  test("L3: same-status evidence persists while no-comment calls remain no-ops", async () => {
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

  test("L5: forbidden transitions and missing tasks retain structured errors", async () => {
    const { task } = await createTask()
    const before = await tasksFile()
    for (const to of ["in_progress", "done", "pending_review"]) {
      expect(await call("task:update", { id: task.id, newStatus: to })).toMatchObject({
        ok: false,
        error: { code: "invalid_transition", details: { from: "backlog", to } },
      })
      expect(await tasksFile()).toBe(before)
    }
    for (const [command, input] of [
      ["task:update", { id: "missing-task", newStatus: "blocked" }],
      ["task:estimate", { id: "missing-task", predictedKTokens: 128, complexity: "large" }],
    ] as const) {
      expect(await call(command, input)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      })
      expect(await callMcp(command.replace(":", "."), input)).toMatchObject({
        ok: false,
        error: { code: "not_found" },
      })
      expect(await tasksFile()).toBe(before)
    }
  }, 15_000)

  test("E1: CLI and MCP preserve 64/65/128 exactly and leave parents/unrelated tasks unchanged", async () => {
    const { epic } = await succeed("epic:create", {
      title: "Estimate epic",
      description: "Fixture",
      outcome: "Preserve hierarchy",
    })
    const { story } = await succeed("story:create", {
      epicId: epic.id,
      title: "Estimate story",
      description: "Fixture",
      userValue: "Durable estimates",
    })
    const { task } = await createTask({ storyId: story.id })
    const { task: unrelated } = await createTask({ title: "Unrelated estimate" })
    const parentFiles = await Promise.all(
      ["epics", "stories"].map((name) =>
        readFile(join(workspaceRoot, `.logbook/storage/${name}.jsonl`), "utf8")
      )
    )
    for (const surface of ["cli", "mcp"] as const) {
      for (const predictedKTokens of [64, 65, 128]) {
        const input = { id: task.id, predictedKTokens, complexity: "large", confidence: "high" }
        expect(
          surface === "cli"
            ? await call("task:estimate", input)
            : await callMcp("task.estimate", input)
        ).toMatchObject({ ok: true, data: { estimate: { predictedKTokens, fibonacci: 21 } } })
        expect((await succeed("task:get", { id: task.id })).task.estimate).toEqual({
          predictedKTokens,
          complexity: "large",
          confidence: "high",
          fibonacci: 21,
        })
      }
    }
    await succeed("task:update", {
      id: task.id,
      newStatus: "blocked",
      comment: { content: "Hierarchy stays linked" },
    })
    expect((await succeed("task:get", { id: unrelated.id })).task).toEqual(unrelated)
    expect(
      await Promise.all(
        ["epics", "stories"].map((name) =>
          readFile(join(workspaceRoot, `.logbook/storage/${name}.jsonl`), "utf8")
        )
      )
    ).toEqual(parentFiles)
    const { task: persisted } = await succeed("task:get", { id: task.id })
    expect(persisted).toMatchObject({ epicId: epic.id, storyId: story.id })
  }, 25_000)

  test("E2: command validation stays distinct from nested estimates and Scrum effort", async () => {
    const { task } = await createTask()
    expect(task.estimate.predictedKTokens).toBe(0)
    const before = await tasksFile()
    for (const invalid of [
      { predictedKTokens: 0 },
      { predictedKTokens: -1 },
      { predictedKTokens: 1.5 },
      { predictedKTokens: "128" },
      { predictedKTokens: null },
      { complexity: "unknown" },
      { confidence: "urgent" },
      { rationale: "é".repeat(2049) },
    ]) {
      const input = { id: task.id, predictedKTokens: 128, complexity: "large", ...invalid }
      expect(await call("task:estimate", input)).toMatchObject({
        ok: false,
        error: { code: "validation_error" },
      })
      expect(await tasksFile()).toBe(before)
      expect((await callMcp("task.estimate", input)).ok).toBe(false)
      expect(await tasksFile()).toBe(before)
    }
    const { estimate } = await succeed("task:estimate", {
      predictedKTokens: 128,
      complexity: "large",
      rationale: "é".repeat(2048),
    })
    expect(estimate).toMatchObject({ predictedKTokens: 128, fibonacci: 21 })
    expect(task).not.toHaveProperty("storyPoints")
    expect(estimate).not.toHaveProperty("storyPoints")
    for (const predictedKTokens of [0, 0.5, 128]) {
      const nested = { predictedKTokens, complexity: "small", confidence: "low", fibonacci: 1 }
      const { task: created } = await createTask({ estimate: nested })
      expect((await succeed("task:get", { id: created.id })).task.estimate).toEqual(nested)
      expect(await callMcp("task.edit", { id: task.id, estimate: nested })).toMatchObject({
        ok: true,
      })
      expect((await succeed("task:get", { id: task.id })).task.estimate).toEqual(nested)
    }
  }, 30_000)

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

  test("I1: CLI and MCP replay identities across restarts and reject conflicting reuse", async () => {
    const input = {
      title: "Watch compatibility task",
      description: "Disposable public API fixture",
      definitionOfDone: "Compatibility is explicit",
      project: "watch",
      milestone: "S02",
      operationId: "watch:create:1",
    }
    const first = await succeed("task:create", input)
    const duplicate = await succeed("task:create", input)
    expect(duplicate.task).toEqual(first.task)
    expect(first.receipt.outcome).toBe("applied")
    expect(duplicate.receipt.outcome).toBe("replayed")
    const before = await tasksFile()
    expect(await call("task:create", { ...input, title: "Different request" })).toMatchObject({
      ok: false,
      error: { code: "operation_conflict" },
    })
    expect(await callMcp("task.create", input)).toMatchObject({ ok: true, data: duplicate })
    expect(await tasksFile()).toBe(before)
    const { items } = await succeed("task:list", { status: "*" })
    expect(items.map((item: { id: string }) => item.id)).toEqual([first.task.id])
    expect(first.task).not.toHaveProperty("operationId")
  }, 15_000)

  test("I2: retrying a reply after a process exit preserves one effect", async () => {
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
    expect(replies).toHaveLength(1)
    expect(replies.map((reply: { content: string }) => reply.content)).toEqual([
      "Reviewer evidence",
    ])
  }, 15_000)
})
