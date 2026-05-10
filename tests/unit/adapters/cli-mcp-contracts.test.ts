import { describe, expect, test } from "bun:test"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { runCli } from "@logbook/workspace/cli-adapter.js"
import { cliCommands } from "@logbook/workspace/cli-commands.js"
import { mcpToolRegistry } from "@logbook/workspace/mcp-tools.js"
import { translateV1CliCommand, v1CliAliases } from "@logbook/workspace/v1-cli-aliases.js"

const parseEnvelope = (stdout: string): unknown => {
  const lines = stdout.trim().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? "{}")
}

describe("CLI and MCP adapter contracts", () => {
  test("exposes colon-style aliases for every dotted Ohtools tool id", () => {
    expect(cliCommands.find((command) => command.toolId === "task.create")).toMatchObject({
      alias: "task:create",
      toolId: "task.create",
    })
    expect(
      cliCommands.find((command) => command.toolId === "task.assign.phase-model")
    ).toMatchObject({
      alias: "task:assign:phase-model",
      toolId: "task.assign.phase-model",
    })
    expect(cliCommands.find((command) => command.alias === "create-task")).toMatchObject({
      alias: "create-task",
      toolId: "task.create",
      compatibility: "v1",
    })
  })

  test("exposes canonical dotted MCP tools with public object-rooted schemas", () => {
    const tools = mcpToolRegistry.listTools()
    const toolNames = tools.map((tool) => tool.name)

    expect(toolNames).toContain("task.create")
    expect(toolNames).toContain("task.assign.phase-model")
    expect(toolNames).not.toContain("task.assign.phase_model")
    expect(toolNames).not.toContain("ohtools.explore")
    expect(toolNames).not.toContain("ohtools.graph")

    expect(tools.find((tool) => tool.name === "task.create")).toMatchObject({
      name: "task.create",
      inputSchema: publicToolSchemas["task.create"].jsonSchema,
    })
    expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(true)
    expect(tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true)
  })

  test("exports retained v1 CLI aliases as compatibility routes into v2 tools", () => {
    expect(v1CliAliases).toEqual([
      { alias: "create-task", toolId: "task.create", compatibility: "v1" },
      { alias: "list-tasks", toolId: "task.list", compatibility: "v1" },
      { alias: "current-task", toolId: "task.current", compatibility: "v1" },
      { alias: "update-task", toolId: "task.update", compatibility: "v1" },
      { alias: "edit-task", toolId: "task.edit", compatibility: "v1" },
      { alias: "init", toolId: "workspace.init", compatibility: "v1" },
    ])
  })

  test("translates v1 task arguments into v2 tool input with a compatibility warning", () => {
    expect(
      translateV1CliCommand("create-task", {
        title: "Preserve legacy aliases",
        description: "Map v1 task fields.",
        definition_of_done: ["Focused tests pass", "Typecheck passes"],
        test_cases: ["legacy smoke", "legacy regression"],
        project: "migration",
        milestone: "task-25",
        assigned_session: "session-1",
        assigned_model: "gpt-5.4",
        estimation: 5,
        predictedKTokens: 12,
      })
    ).toMatchObject({
      toolId: "task.create",
      input: {
        title: "Preserve legacy aliases",
        description: "Map v1 task fields.",
        definitionOfDone: "Focused tests pass\nTypecheck passes",
        definitionOfReady: "legacy smoke\nlegacy regression",
        project: "migration",
        milestone: "task-25",
        sessionId: "session-1",
        model: { id: "gpt-5.4" },
        estimate: {
          predictedKTokens: 12,
          fibonacci: 5,
          complexity: "small",
          confidence: "medium",
        },
      },
      warnings: [
        {
          code: "compatibility_mapping_applied",
          message: "V1 CLI arguments were translated to v2 tool input.",
          details: {
            alias: "create-task",
            toolId: "task.create",
            fields: [
              "definition_of_done",
              "test_cases",
              "assigned_session",
              "assigned_model",
              "estimation",
              "predictedKTokens",
            ],
          },
        },
      ],
    })
  })

  test("translates v1 update-task comment kind into v2 comment input", () => {
    expect(
      translateV1CliCommand("update-task", {
        id: "task-1",
        new_status: "need_info",
        comment_title: "Question",
        comment_content: "Need deployment details.",
        comment_kind: "need_info",
      })
    ).toMatchObject({
      toolId: "task.update",
      input: {
        id: "task-1",
        newStatus: "need_info",
        comment: {
          title: "Question",
          content: "Need deployment details.",
          kind: "need_info",
        },
      },
      warnings: [
        {
          code: "compatibility_mapping_applied",
          details: {
            fields: ["new_status", "comment_title", "comment_content", "comment_kind"],
          },
        },
      ],
    })
  })

  test("runs a colon alias through the Ohtools registry and writes one success envelope", async () => {
    let stdout = ""
    const exitCode = await runCli(["plugin:list"], {
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(parseEnvelope(stdout)).toMatchObject({
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

  test("rejects non-object stdin JSON with cli_parse_error and one error envelope", async () => {
    let stdout = ""
    const exitCode = await runCli(["plugin:list"], {
      stdin: "[]",
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(1)
    expect(parseEnvelope(stdout)).toEqual({
      ok: false,
      error: {
        code: "cli_parse_error",
        message: "CLI input must be a JSON object.",
      },
    })
  })

  test("bounds argument count and result JSON bytes", async () => {
    let tooManyArgsStdout = ""
    const tooManyArgsExitCode = await runCli(
      ["plugin:list", ...Array.from({ length: 201 }, (_, index) => `--arg-${index}`)],
      {
        stdout: (chunk) => {
          tooManyArgsStdout += chunk
        },
      }
    )

    expect(tooManyArgsExitCode).toBe(1)
    expect(parseEnvelope(tooManyArgsStdout)).toEqual({
      ok: false,
      error: {
        code: "cli_parse_error",
        message: "CLI arguments exceed 200.",
        details: {
          actualCount: 202,
          maxArgs: 200,
        },
      },
    })

    let oversizedResultStdout = ""
    const oversizedResultExitCode = await runCli(["plugin:list"], {
      maxResultJsonBytes: 64,
      stdout: (chunk) => {
        oversizedResultStdout += chunk
      },
    })

    expect(oversizedResultExitCode).toBe(1)
    expect(parseEnvelope(oversizedResultStdout)).toEqual({
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
