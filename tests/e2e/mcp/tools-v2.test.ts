import { describe, expect, test } from "bun:test"
import { createMcpServer } from "@logbook/workspace/mcp-server.js"

const parseTextEnvelope = (result: unknown): unknown => {
  const content = (result as { content?: Array<{ type?: unknown; text?: unknown }> }).content
  expect(Array.isArray(content)).toBe(true)
  expect(content?.[0]?.type).toBe("text")
  expect(typeof content?.[0]?.text).toBe("string")

  const text = content?.[0]?.text as string
  return JSON.parse(text)
}

describe("MCP v2 tools adapter", () => {
  test("lists canonical Logbook tool names and schemas through tools/list", async () => {
    const server = createMcpServer()
    const result = await server.dispatch("tools/list", {})
    const tools = (
      result as { tools?: Array<{ name: string; inputSchema: Record<string, unknown> }> }
    ).tools
    expect(Array.isArray(tools)).toBe(true)

    const taskCreate = tools?.find((tool) => tool.name === "task.create")
    expect(taskCreate?.inputSchema).toMatchObject({
      type: "object",
      required: ["title", "description", "definitionOfDone", "project", "milestone"],
      additionalProperties: false,
    })

    const names = tools?.map((tool) => tool.name) ?? []
    expect(names).toContain("task.assign.phase-model")
    expect(names).toEqual(
      expect.arrayContaining([
        "sync.linear.pull",
        "sync.linear.push",
        "sync.linear.setup",
        "sync.linear.status",
      ])
    )
    expect(names).not.toContain("task.assign.phase_model")
    expect(names.some((name) => name.startsWith("sync.github."))).toBe(false)
    expect(names).not.toContain("ohtools.explore")
  })

  test("calls canonical dotted tools through the Ohtools runtime and returns a text ToolResult envelope", async () => {
    const server = createMcpServer()
    const result = await server.dispatch("tools/call", {
      name: "plugin.list",
      arguments: {},
    })

    expect(parseTextEnvelope(result)).toMatchObject({
      ok: true,
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "task",
            toolIds: expect.arrayContaining(["task.create", "task.list"]),
          }),
        ]),
        hasMore: false,
      },
    })
  })

  test("bounds MCP input JSON and ToolResult JSON with public error envelopes", async () => {
    const server = createMcpServer({
      maxMcpInputJsonBytes: 8,
      maxResultJsonBytes: 64,
    })

    expect(
      parseTextEnvelope(
        await server.dispatch("tools/call", {
          name: "plugin.list",
          arguments: { oversized: true },
        })
      )
    ).toEqual({
      ok: false,
      error: {
        code: "schema_validation_error",
        message: "MCP tool input JSON exceeds 8 bytes.",
        details: {
          actualBytes: 18,
          maxBytes: 8,
        },
      },
    })

    expect(
      parseTextEnvelope(
        await server.dispatch("tools/call", {
          name: "plugin.list",
          arguments: {},
        })
      )
    ).toEqual({
      ok: false,
      error: {
        code: "adapter_error",
        message: "Tool result JSON exceeds 64 bytes.",
        details: {
          maxBytes: 64,
        },
      },
    })
  })
})
