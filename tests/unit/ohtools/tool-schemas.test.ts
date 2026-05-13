import { describe, expect, test } from "bun:test"
import { parseWithSchema } from "@bosun-sh/ohtools"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { createLogbookApp } from "@logbook/workspace/ohtools-app.js"

describe("publicToolSchemas", () => {
  test("defines one object-rooted schema for every currently registered public tool", () => {
    const registry = createLogbookApp().build()
    const toolIds = [...registry.tools.keys()].sort()
    const schemaIds = Object.keys(publicToolSchemas).sort()

    expect(schemaIds).toEqual(toolIds)
    expect(toolIds).toEqual(
      expect.arrayContaining([
        "sync.linear.pull",
        "sync.linear.push",
        "sync.linear.setup",
        "sync.linear.status",
        "sync.conflicts.list",
        "sync.conflicts.resolve",
      ])
    )
    expect(toolIds.some((toolId) => toolId.startsWith("sync.github."))).toBe(false)

    for (const [toolId, schema] of Object.entries(publicToolSchemas)) {
      expect(schema.jsonSchema).toBeDefined()
      expect(schema.jsonSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      })

      if (toolId === "task.assign.phase-model") {
        // Task 21 currently registers `task.assign.phase-model` even though the
        // task 22 spec references `task.assign.phase_model`.
        expect(schema.jsonSchema?.required).toEqual(["id", "phase", "model"])
      }
    }
  })

  test("uses v2 field names and rejects compatibility aliases at the input boundary", () => {
    const parsed = parseWithSchema(
      publicToolSchemas["task.create"],
      {
        title: "Schema check",
        description: "Uses v2 field names",
        definitionOfDone: "done",
        project: "logbook",
        milestone: "v2",
      },
      ["task.create"]
    )

    expect(parsed).toEqual({
      title: "Schema check",
      description: "Uses v2 field names",
      definitionOfDone: "done",
      project: "logbook",
      milestone: "v2",
    })

    expect(() =>
      parseWithSchema(
        publicToolSchemas["task.create"],
        {
          title: "Schema check",
          description: "Uses v2 field names",
          definition_of_done: "legacy alias",
          project: "logbook",
          milestone: "v2",
        },
        ["task.create"]
      )
    ).toThrow()

    expect(() =>
      parseWithSchema(
        publicToolSchemas["task.create"],
        {
          title: "Schema check",
          description: "Uses v2 field names",
          definitionOfReady: "v1 test cases are accepted only through v1 aliases",
          definitionOfDone: "done",
          project: "logbook",
          milestone: "v2",
        },
        ["task.create"]
      )
    ).toThrow()
  })

  test("accepts the current phase-model tool id and rejects unknown fields", () => {
    const parsed = parseWithSchema(
      publicToolSchemas["task.assign.phase-model"],
      {
        id: "task_123",
        phase: "dev",
        model: {
          id: "gpt-5",
          provider: "openai",
        },
      },
      ["task.assign.phase-model"]
    )

    expect(parsed).toEqual({
      id: "task_123",
      phase: "dev",
      model: {
        id: "gpt-5",
        provider: "openai",
      },
    })

    expect(() =>
      parseWithSchema(
        publicToolSchemas["task.assign.phase-model"],
        {
          id: "task_123",
          phase: "dev",
          model: {
            id: "gpt-5",
          },
          extra: true,
        },
        ["task.assign.phase-model"]
      )
    ).toThrow()
  })

  test("linear schemas are object-rooted and reject GitHub/provider drift", () => {
    expect(
      parseWithSchema(publicToolSchemas["sync.linear.status"], {}, ["sync.linear.status"])
    ).toEqual({})

    expect(() =>
      parseWithSchema(
        publicToolSchemas["sync.linear.status"],
        { checkProvider: true, provider: "github" },
        ["sync.linear.status"]
      )
    ).toThrow()

    expect(() =>
      parseWithSchema(publicToolSchemas["sync.conflicts.list"], { provider: "github" }, [
        "sync.conflicts.list",
      ])
    ).toThrow()
  })
})
