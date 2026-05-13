import { describe, expect, test } from "bun:test"
import { listPlugins } from "@logbook/plugin/list.js"
import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"

const decodeCursor = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))

describe("listPlugins", () => {
  test("returns current-stage plugin metadata in deterministic order", () => {
    const result = listPlugins({}, registerLogbookTools())

    expect(result).toEqual({
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
              "sync.linear.setup",
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

  test("paginates deterministically and emits has_more warnings", () => {
    const registry = registerLogbookTools({
      version: "2.0.0-test",
      plugins: Array.from({ length: 101 }, (_, index) => ({
        id: `plugin${String(index + 1).padStart(3, "0")}`,
        name: `plugin${String(index + 1).padStart(3, "0")}`,
        version: "2.0.0-test",
        enabled: true,
        groups: [`plugin${String(index + 1).padStart(3, "0")}`],
        toolIds: [],
      })),
    })

    const firstPage = listPlugins({ limit: 100 }, registry)
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) {
      return
    }

    expect(firstPage.data.items).toHaveLength(100)
    expect(firstPage.data.hasMore).toBe(true)
    expect(firstPage.data.nextCursor).toBeDefined()
    expect(firstPage.warnings).toEqual([
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: { cursor: firstPage.data.nextCursor },
      },
    ])
    expect(decodeCursor(firstPage.data.nextCursor!)).toEqual({
      kind: "plugin.list",
      lastId: "plugin100",
      lastSort: ["plugin100"],
    })

    const secondPage = listPlugins({ cursor: firstPage.data.nextCursor }, registry)
    expect(secondPage).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "plugin101",
            name: "plugin101",
            version: "2.0.0-test",
            enabled: true,
            groups: ["plugin101"],
            toolIds: [],
          },
        ],
        hasMore: false,
      },
    })
  })

  test("caps requested limits at 100", () => {
    const registry = registerLogbookTools({
      version: "2.0.0-test",
      plugins: Array.from({ length: 150 }, (_, index) => ({
        id: `plugin${String(index + 1).padStart(3, "0")}`,
        name: `plugin${String(index + 1).padStart(3, "0")}`,
        version: "2.0.0-test",
        enabled: true,
        groups: [`plugin${String(index + 1).padStart(3, "0")}`],
        toolIds: [],
      })),
    })

    const result = listPlugins({ limit: 500 }, registry)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.data.items).toHaveLength(100)
    expect(result.data.hasMore).toBe(true)
  })
})
