import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMcpServer } from "@logbook/workspace/mcp-server.js"

let workspaceRoot: string | undefined
const originalCwd = process.cwd()

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-27-mcp-"))
  return workspaceRoot
}

const parseTextEnvelope = (result: unknown): any => {
  const content = (result as { content?: Array<{ type?: unknown; text?: unknown }> }).content
  expect(Array.isArray(content)).toBe(true)
  expect(content?.[0]?.type).toBe("text")
  expect(typeof content?.[0]?.text).toBe("string")
  return JSON.parse(content?.[0]?.text as string)
}

afterEach(async () => {
  process.chdir(originalCwd)
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("workspace MCP hooks surface", () => {
  test("lists workspace.init and workspace.status and calls them through the shared Ohtools runtime", async () => {
    const root = await makeWorkspace()
    const server = createMcpServer()
    const listed = await server.dispatch("tools/list", {})
    const tools = (
      listed as { tools?: Array<{ name: string; inputSchema: Record<string, unknown> }> }
    ).tools

    expect(tools?.find((tool) => tool.name === "workspace.init")).toMatchObject({
      name: "workspace.init",
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    })
    expect(tools?.find((tool) => tool.name === "workspace.status")).toMatchObject({
      name: "workspace.status",
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    })

    const called = await server.dispatch("tools/call", {
      name: "workspace.init",
      arguments: { path: root },
    })

    expect(parseTextEnvelope(called)).toMatchObject({
      ok: true,
      data: {
        workspace: {
          path: root,
          schemaVersion: 2,
        },
        createdPaths: expect.any(Array),
      },
    })
    expect((await stat(join(root, ".logbook/hooks"))).isDirectory()).toBe(true)

    const status = await server.dispatch("tools/call", {
      name: "workspace.status",
      arguments: { path: root },
    })

    expect(parseTextEnvelope(status)).toMatchObject({
      ok: true,
      data: {
        status: {
          path: root,
          initialized: true,
          schemaVersion: 2,
          storage: {
            canonicalFilesPresent: true,
            duckdbIndexPresent: false,
          },
        },
      },
    })
  })

  test("lists and runs configured hooks through MCP text envelopes", async () => {
    const root = await makeWorkspace()
    const server = createMcpServer()

    const initialized = await server.dispatch("tools/call", {
      name: "workspace.init",
      arguments: { path: root },
    })
    expect(parseTextEnvelope(initialized).ok).toBe(true)

    await writeFile(
      join(root, ".logbook/hooks/notify.json"),
      JSON.stringify({
        id: "notify",
        enabled: true,
        event: "task.status_changed",
        command: ["bun", "-e", "console.log('mcp hook')"],
      })
    )
    process.chdir(root)

    const listed = await server.dispatch("tools/list", {})
    const tools = (
      listed as { tools?: Array<{ name: string; inputSchema: Record<string, unknown> }> }
    ).tools
    expect(tools?.find((tool) => tool.name === "hook.list")).toMatchObject({
      name: "hook.list",
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    })
    expect(tools?.find((tool) => tool.name === "hook.run")).toMatchObject({
      name: "hook.run",
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    })

    const hookList = await server.dispatch("tools/call", {
      name: "hook.list",
      arguments: { event: "task.status_changed" },
    })
    expect(parseTextEnvelope(hookList)).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: "notify",
            event: "task.status_changed",
            command: "bun -e console.log('mcp hook')",
            enabled: true,
            timeoutMs: 5000,
          },
        ],
        hasMore: false,
      },
    })

    const hookRun = await server.dispatch("tools/call", {
      name: "hook.run",
      arguments: { hookId: "notify", event: "task.status_changed" },
    })
    const envelope = parseTextEnvelope(hookRun)
    expect(envelope).toMatchObject({
      ok: true,
      data: {
        hookId: "notify",
        event: "task.status_changed",
        exitCode: 0,
        timedOut: false,
        stdout: "mcp hook\n",
      },
    })
    expect(envelope.data).toHaveProperty("startedAt")
    expect(envelope.data).toHaveProperty("finishedAt")
  })
})
