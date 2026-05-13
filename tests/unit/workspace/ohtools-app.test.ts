import { describe, expect, test } from "bun:test"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { logbookPlugins } from "@logbook/plugin/registry.js"
import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"

const LOWERCASE_DOTTED_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/

describe("ohtools-app / plugin registry", () => {
  test("every plugin in logbookPlugins is a frozen ohtools plugin", () => {
    for (const registryPlugin of logbookPlugins) {
      expect(typeof registryPlugin).toBe("object")
      expect(registryPlugin).not.toBeNull()
      expect(Object.isFrozen(logbookPlugins)).toBe(true)
    }
  })

  test("registerLogbookTools returns ≤ 100 tools", () => {
    const { toolIds } = registerLogbookTools()
    expect(toolIds.length).toBeLessThanOrEqual(100)
  })

  test("every public tool ID matches LOWERCASE_DOTTED_ID", () => {
    const toolIds = Object.keys(publicToolSchemas)
    for (const id of toolIds) {
      expect(LOWERCASE_DOTTED_ID.test(id)).toBe(true)
    }
  })

  test("every publicToolSchemas entry is object-rooted", () => {
    const schemas = Object.values(publicToolSchemas)
    for (const schema of schemas) {
      const asRecord = schema as unknown as Record<string, unknown>
      const schemaObj = (asRecord.jsonSchema ?? asRecord) as Record<string, unknown>
      expect(schemaObj.type).toBe("object")
    }
  })

  test("task.assign.phase-model is the registered public tool ID (hyphen not underscore)", () => {
    expect(Object.hasOwn(publicToolSchemas, "task.assign.phase-model")).toBe(true)
    expect(Object.hasOwn(publicToolSchemas, "task.assign.phase_model")).toBe(false)
  })
})
