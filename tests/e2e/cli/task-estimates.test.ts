import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import { LogbookLayer } from "@logbook/workspace/layers.js"
import { type CreateMcpServerOptions, createMcpServer } from "@logbook/workspace/mcp-server.js"

const entry = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")

describe("Task estimates through CLI and MCP", () => {
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
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-estimates-"))
    await succeed("workspace:init", { path: workspaceRoot, migrateV1: false })
    const configPath = join(workspaceRoot, ".logbook/config.json")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    config.hooks.enabled = false
    await writeFile(configPath, JSON.stringify(config))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("CLI and MCP persist 64/65/128 exactly and preserve unrelated tasks", async () => {
    const { task } = await createTask()
    const { task: unrelated } = await createTask({ title: "Unrelated estimate" })
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
    expect((await succeed("task:get", { id: unrelated.id })).task).toEqual(unrelated)
  }, 25_000)

  test("command validation and create/edit/read semantics remain unchanged", async () => {
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
})
