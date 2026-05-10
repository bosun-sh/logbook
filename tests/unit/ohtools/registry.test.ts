import { describe, expect, test } from "bun:test"
import type { OhtoolsError, RunResult } from "@bosun-sh/ohtools"
import { logbookPlugins } from "@logbook/plugin/registry.js"
import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"
import { createLogbookApp } from "@logbook/workspace/ohtools-app.js"
import { Effect } from "effect"

const EXPECTED_TOOL_IDS = [
  "context.attach",
  "context.create",
  "context.delete",
  "context.detach",
  "context.get",
  "context.list",
  "context.search",
  "context.update",
  "epic.create",
  "epic.delete",
  "epic.get",
  "epic.list",
  "epic.update",
  "hook.list",
  "hook.run",
  "plugin.list",
  "story.create",
  "story.delete",
  "story.get",
  "story.list",
  "story.update",
  "sync.conflicts.list",
  "sync.conflicts.resolve",
  "sync.linear.pull",
  "sync.linear.push",
  "sync.linear.status",
  "task.assign.model",
  "task.assign.phase-model",
  "task.assign.session",
  "task.create",
  "task.current",
  "task.edit",
  "task.estimate",
  "task.get",
  "task.list",
  "task.update",
  "workspace.init",
  "workspace.status",
] as const

const EXPECTED_PLUGIN_NAMES = [
  "context",
  "epic",
  "hook",
  "plugin",
  "story",
  "sync",
  "task",
  "workspace",
] as const
const LOWERCASE_DOTTED_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/
const textEncoder = new TextEncoder()

describe("logbook ohtools registry", () => {
  test("builds a static registry for the current epic, story, task, context, workspace, and plugin-list surfaces", () => {
    const app = createLogbookApp()
    const registry = app.build()
    const toolIds = [...registry.tools.keys()].sort()
    const groupIds = [...registry.groups.keys()].sort()

    expect(toolIds).toEqual([...EXPECTED_TOOL_IDS])
    expect(groupIds).toEqual([
      "context",
      "epic",
      "hook",
      "plugin",
      "story",
      "sync",
      "task",
      "workspace",
    ])
    expect(toolIds).toHaveLength(38)
    expect(toolIds.every((id) => LOWERCASE_DOTTED_ID.test(id))).toBe(true)
    expect(toolIds.filter((id) => id.startsWith("workspace."))).toEqual([
      "workspace.init",
      "workspace.status",
    ])
    expect(toolIds.filter((id) => id.startsWith("hook."))).toEqual(["hook.list", "hook.run"])
    expect(toolIds.filter((id) => id.startsWith("sync.conflicts."))).toEqual([
      "sync.conflicts.list",
      "sync.conflicts.resolve",
    ])
    expect(toolIds.filter((id) => id.startsWith("sync.linear."))).toEqual([
      "sync.linear.pull",
      "sync.linear.push",
      "sync.linear.status",
    ])
    expect(toolIds.some((id) => id.startsWith("linear."))).toBe(false)
  })

  test("exports static plugin builders and keeps every tool description under the registration bound", () => {
    const app = createLogbookApp()
    const registry = app.build()
    const registered = registerLogbookTools()

    expect(logbookPlugins.map((plugin) => plugin.name).sort()).toEqual([...EXPECTED_PLUGIN_NAMES])
    expect(registered.metadata.map((plugin) => plugin.id)).toEqual([...EXPECTED_PLUGIN_NAMES])
    expect(registered.groups.map((group) => group.id)).toEqual([...EXPECTED_PLUGIN_NAMES])
    expect(registered.toolIds).toEqual([...EXPECTED_TOOL_IDS])

    for (const [toolId, tool] of registry.tools) {
      expect(textEncoder.encode(tool.description).length).toBeLessThanOrEqual(2048)
      expect(toolId).toMatch(LOWERCASE_DOTTED_ID)
    }
  })

  test("fails registration when more than 100 tools are provided", () => {
    expect(() =>
      registerLogbookTools({
        plugins: Array.from({ length: 101 }, (_, index) => ({
          id: `plugin${String(index + 1).padStart(3, "0")}`,
          name: `plugin${String(index + 1).padStart(3, "0")}`,
          version: "2.0.0-test",
          enabled: true,
          groups: [`plugin${String(index + 1).padStart(3, "0")}`],
          toolIds: [`plugin${String(index + 1).padStart(3, "0")}.list`],
        })),
      })
    ).toThrow(/registered tools exceed 100/)
  })

  test("runs plugin.list from static registry metadata", async () => {
    const app = createLogbookApp()
    const runtime = app.runtime()

    const result = (await Effect.runPromise(
      runtime.run({
        toolId: "plugin.list",
        input: {},
      }) as unknown as Effect.Effect<RunResult<unknown>, OhtoolsError, never>
    )) as RunResult<unknown>

    expect(result.toolId).toBe("plugin.list")
    expect(result.output).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "context",
            name: "context",
            version: "2.0.0",
            enabled: true,
            groups: ["context"],
            toolIds: [
              "context.attach",
              "context.create",
              "context.delete",
              "context.detach",
              "context.get",
              "context.list",
              "context.search",
              "context.update",
            ],
          },
          {
            id: "epic",
            name: "epic",
            version: "2.0.0",
            enabled: true,
            groups: ["epic"],
            toolIds: ["epic.create", "epic.delete", "epic.get", "epic.list", "epic.update"],
          },
          {
            id: "hook",
            name: "hook",
            version: "2.0.0",
            enabled: true,
            groups: ["hook"],
            toolIds: ["hook.list", "hook.run"],
          },
          {
            id: "plugin",
            name: "plugin",
            version: "2.0.0",
            enabled: true,
            groups: ["plugin"],
            toolIds: ["plugin.list"],
          },
          {
            id: "story",
            name: "story",
            version: "2.0.0",
            enabled: true,
            groups: ["story"],
            toolIds: ["story.create", "story.delete", "story.get", "story.list", "story.update"],
          },
          {
            id: "sync",
            name: "sync",
            version: "2.0.0",
            enabled: true,
            groups: ["sync"],
            toolIds: [
              "sync.conflicts.list",
              "sync.conflicts.resolve",
              "sync.linear.pull",
              "sync.linear.push",
              "sync.linear.status",
            ],
          },
          {
            id: "task",
            name: "task",
            version: "2.0.0",
            enabled: true,
            groups: ["task"],
            toolIds: [
              "task.assign.model",
              "task.assign.phase-model",
              "task.assign.session",
              "task.create",
              "task.current",
              "task.edit",
              "task.estimate",
              "task.get",
              "task.list",
              "task.update",
            ],
          },
          {
            id: "workspace",
            name: "workspace",
            version: "2.0.0",
            enabled: true,
            groups: ["workspace"],
            toolIds: ["workspace.init", "workspace.status"],
          },
        ],
        hasMore: false,
      },
    })
  })

  test("wires task.estimate through the app runtime", async () => {
    const app = createLogbookApp()
    const runtime = app.runtime()

    const result = (await Effect.runPromise(
      runtime.run({
        toolId: "task.estimate",
        input: {
          predictedKTokens: 8,
          complexity: "large",
          confidence: "high",
          rationale: "Bounded estimate through the registry runtime.",
        },
      }) as unknown as Effect.Effect<RunResult<unknown>, OhtoolsError, never>
    )) as RunResult<unknown>

    expect(result.toolId).toBe("task.estimate")
    expect(result.output).toEqual({
      ok: true,
      data: {
        estimate: {
          predictedKTokens: 8,
          complexity: "large",
          fibonacci: 8,
          confidence: "high",
          rationale: "Bounded estimate through the registry runtime.",
        },
      },
    })
  })
})
