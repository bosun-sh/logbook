import { describe, expect, test } from "bun:test"
import { resolveTaskModel } from "@logbook/task/model-assignment.js"
import type { Task } from "@logbook/task/schema.js"

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-15",
  title: "Model resolution",
  description: "Resolve task models",
  definitionOfDone: "Model resolution works",
  status: "todo",
  priority: 0,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 1,
    complexity: "small",
    fibonacci: 1,
    confidence: "low",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

describe("resolveTaskModel", () => {
  test("uses the phase override before the task default", () => {
    const task = makeTask({
      model: { id: "gpt-5.4-mini" },
      phaseModelOverrides: {
        dev: { id: "gpt-5.4-dev" },
      },
    })

    const result = resolveTaskModel({ task, phase: "dev" })

    expect(result).toEqual({
      ok: true,
      data: {
        resolvedModel: { id: "gpt-5.4-dev" },
      },
    })
  })

  test("falls back to the task default when no phase override exists", () => {
    const task = makeTask({
      model: { id: "gpt-5.4-mini" },
    })

    const result = resolveTaskModel({ task, phase: "test" })

    expect(result).toEqual({
      ok: true,
      data: {
        resolvedModel: { id: "gpt-5.4-mini" },
      },
    })
  })

  test("returns validation_error for an unknown phase", () => {
    const task = makeTask({
      model: { id: "gpt-5.4-mini" },
    })

    const result = resolveTaskModel({ task, phase: "deploy" })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected resolution to fail")
    }

    expect(result.error.code).toBe("validation_error")
  })

  test("returns validation_error when a required model is missing", () => {
    const task = makeTask()

    const result = resolveTaskModel({ task, phase: "plan" })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected resolution to fail")
    }

    expect(result.error.code).toBe("validation_error")
  })

  test("can return ok with no model when resolution is optional", () => {
    const task = makeTask()

    const result = resolveTaskModel({ task, phase: "validate", requireModel: false })

    expect(result).toEqual({
      ok: true,
      data: {
        resolvedModel: undefined,
      },
    })
  })
})
