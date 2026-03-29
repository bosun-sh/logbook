import { beforeEach, describe, expect, test } from "bun:test"
import { toolEditTask } from "@logbook/mcp/tool-edit-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

let repo: InMemoryTaskRepository
let layer: Layer.Layer<TaskRepository>

const seedTask = async (overrides: Parameters<typeof makeTask>[0] = {}) => {
  const task = makeTask(overrides)
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(TaskRepository, (r) => r.save(task)),
      layer
    ) as Effect.Effect<void, never>
  )
  return task
}

beforeEach(() => {
  repo = new InMemoryTaskRepository()
  layer = Layer.succeed(TaskRepository, repo)
})

describe("toolEditTask / happy path", () => {
  test("edits title; returns { task } with updated title", async () => {
    const task = await seedTask()
    const result = await toolEditTask({ id: task.id, title: "Updated Title" }, layer)
    expect(result).toHaveProperty("task")
    const updated = result.task as Record<string, unknown>
    expect(updated.title).toBe("Updated Title")
    expect(updated.status).toBe(task.status)
  })

  test("edits description", async () => {
    const task = await seedTask()
    const result = await toolEditTask({ id: task.id, description: "New description" }, layer)
    const updated = result.task as Record<string, unknown>
    expect(updated.description).toBe("New description")
  })

  test("edits definition_of_done", async () => {
    const task = await seedTask()
    const result = await toolEditTask({ id: task.id, definition_of_done: "New DoD" }, layer)
    const updated = result.task as Record<string, unknown>
    expect(updated.definition_of_done).toBe("New DoD")
  })

  test("edits estimation via predictedKTokens (8 → 3)", async () => {
    const task = await seedTask()
    const result = await toolEditTask({ id: task.id, predictedKTokens: 8 }, layer)
    const updated = result.task as Record<string, unknown>
    expect(updated.estimation).toBe(3)
  })

  test("partial update: only specified fields change", async () => {
    const task = await seedTask({ title: "Original", description: "Keep me" })
    const result = await toolEditTask({ id: task.id, title: "Changed" }, layer)
    const updated = result.task as Record<string, unknown>
    expect(updated.title).toBe("Changed")
    expect(updated.description).toBe("Keep me")
  })
})

const expectThrows = async (fn: () => unknown) => {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
}

describe("toolEditTask / Zod validation rejects", () => {
  test("missing id → throws ZodError", async () => {
    await expectThrows(() => toolEditTask({ title: "X" }, layer))
  })

  test("empty id → throws ZodError", async () => {
    await expectThrows(() => toolEditTask({ id: "", title: "X" }, layer))
  })

  test("non-positive predictedKTokens → throws ZodError", async () => {
    const task = await seedTask()
    await expectThrows(() => toolEditTask({ id: task.id, predictedKTokens: 0 }, layer))
  })
})

describe("toolEditTask / domain errors bubble as rejections", () => {
  test("unknown id → rejects with not_found", async () => {
    await expect(toolEditTask({ id: "ghost-id", title: "X" }, layer)).rejects.toBeDefined()
  })
})
