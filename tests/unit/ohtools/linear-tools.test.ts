import { describe, expect, test } from "bun:test"
import { parseWithSchema } from "@bosun-sh/ohtools"
import { linearPullTool } from "@logbook/plugin/linear-pull-tool.js"
import { linearPushTool } from "@logbook/plugin/linear-push-tool.js"
import { linearStatusTool } from "@logbook/plugin/linear-status-tool.js"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"

describe("Linear Ohtools surface", () => {
  test("registers the Linear sync tools through the static sync plugin", () => {
    const registered = registerLogbookTools()

    expect(linearPullTool.id).toBe("sync.linear.pull")
    expect(linearPushTool.id).toBe("sync.linear.push")
    expect(linearStatusTool.id).toBe("sync.linear.status")
    expect(registered.metadata.find((plugin) => plugin.id === "sync")).toMatchObject({
      id: "sync",
      toolIds: [
        "sync.conflicts.list",
        "sync.conflicts.resolve",
        "sync.linear.pull",
        "sync.linear.push",
        "sync.linear.status",
      ],
    })
  })

  test("defines object-rooted schemas for sync.linear.pull, sync.linear.push, and sync.linear.status", () => {
    expect(publicToolSchemas["sync.linear.pull"].jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(publicToolSchemas["sync.linear.push"].jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(publicToolSchemas["sync.linear.status"].jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })

    expect(
      parseWithSchema(
        publicToolSchemas["sync.linear.pull"],
        {
          since: "2026-01-01T00:00:00.000Z",
          teamId: "team_1",
          limit: 25,
          dryRun: true,
        },
        ["sync.linear.pull"]
      )
    ).toEqual({
      since: "2026-01-01T00:00:00.000Z",
      teamId: "team_1",
      limit: 25,
      dryRun: true,
    })

    expect(() =>
      parseWithSchema(
        publicToolSchemas["sync.linear.pull"],
        {
          dryRun: true,
          unknown: true,
        },
        ["sync.linear.pull"]
      )
    ).toThrow()

    expect(
      parseWithSchema(
        publicToolSchemas["sync.linear.push"],
        {
          taskIds: ["task_1"],
          epicIds: ["epic_1"],
          storyIds: ["story_1"],
          teamId: "team_1",
          projectId: "project_1",
          dryRun: true,
        },
        ["sync.linear.push"]
      )
    ).toEqual({
      taskIds: ["task_1"],
      epicIds: ["epic_1"],
      storyIds: ["story_1"],
      teamId: "team_1",
      projectId: "project_1",
      dryRun: true,
    })

    expect(() =>
      parseWithSchema(
        publicToolSchemas["sync.linear.push"],
        {
          taskIds: ["task_1"],
          extra: true,
        },
        ["sync.linear.push"]
      )
    ).toThrow()

    expect(
      parseWithSchema(
        publicToolSchemas["sync.linear.status"],
        {
          checkProvider: true,
        },
        ["sync.linear.status"]
      )
    ).toEqual({
      checkProvider: true,
    })
  })
})
