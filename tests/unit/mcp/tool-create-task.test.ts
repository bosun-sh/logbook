import { beforeEach, describe, expect, test } from "bun:test"
import { toolCreateTask } from "@logbook/mcp/tool-create-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Layer } from "effect"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

let repo: InMemoryTaskRepository
let layer: Layer.Layer<TaskRepository>

beforeEach(() => {
  repo = new InMemoryTaskRepository()
  layer = Layer.succeed(TaskRepository, repo)
})

const validInput = {
  project: "alpha",
  milestone: "m1",
  title: "My task",
  definition_of_done: ["It passes tests"],
  test_cases: ["The happy path passes"],
  description: "Some description",
  predictedKTokens: 8,
}

describe("toolCreateTask / happy path", () => {
  test("returns { task } with correct shape", async () => {
    const result = await toolCreateTask(validInput, "session-1", layer)
    expect(result).toHaveProperty("task")
    const task = result.task as Record<string, unknown>
    expect(task.status).toBe("backlog")
    expect(task.project).toBe("alpha")
    expect(task.milestone).toBe("m1")
    expect(task.title).toBe("My task")
  })

  test("assignee is undefined on creation", async () => {
    const result = await toolCreateTask(validInput, "session-abc", layer)
    const task = result.task as Record<string, unknown>
    expect(task.assignee).toBeUndefined()
  })

  test("assigned_session is set from the caller", async () => {
    const result = await toolCreateTask(validInput, "session-abc", layer)
    const task = result.task as Record<string, unknown>
    expect(task.assigned_session).toBe("session-abc")
  })

  test("assigned_model is derived from predictedKTokens", async () => {
    const result = await toolCreateTask(validInput, "session-abc", layer)
    const task = result.task as Record<string, unknown>
    expect(task.assigned_model).toBe("claude-sonnet-4-6")
  })

  test("task id is a non-empty string", async () => {
    const result = await toolCreateTask(validInput, "s1", layer)
    const task = result.task as Record<string, unknown>
    expect(typeof task.id).toBe("string")
    expect((task.id as string).length).toBeGreaterThan(0)
  })

  test("estimation derived from predictedKTokens (8 kTokens → 3)", async () => {
    const result = await toolCreateTask(validInput, "s1", layer)
    const task = result.task as Record<string, unknown>
    expect(task.estimation).toBe(3)
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

describe("toolCreateTask / Zod validation rejects", () => {
  const requiredStringFields = ["project", "milestone", "title", "description"] as const

  for (const field of requiredStringFields) {
    test(`empty ${field} → throws ZodError`, async () => {
      const input = { ...validInput, [field]: "" }
      await expectThrows(() => toolCreateTask(input, "s1", layer))
    })

    test(`missing ${field} → throws ZodError`, async () => {
      const { [field]: _omitted, ...rest } = validInput
      await expectThrows(() => toolCreateTask(rest, "s1", layer))
    })
  }

  test("empty definition_of_done array → throws ZodError", async () => {
    const input = { ...validInput, definition_of_done: [] as string[] }
    await expectThrows(() => toolCreateTask(input, "s1", layer))
  })

  test("missing definition_of_done → throws ZodError", async () => {
    const { definition_of_done: _omitted, ...rest } = validInput
    await expectThrows(() => toolCreateTask(rest, "s1", layer))
  })

  test("non-positive predictedKTokens (0) → throws ZodError", async () => {
    const input = { ...validInput, predictedKTokens: 0 }
    await expectThrows(() => toolCreateTask(input, "s1", layer))
  })

  test("negative predictedKTokens → throws ZodError", async () => {
    const input = { ...validInput, predictedKTokens: -5 }
    await expectThrows(() => toolCreateTask(input, "s1", layer))
  })

  test("missing predictedKTokens → throws ZodError", async () => {
    const { predictedKTokens: _omitted, ...rest } = validInput
    await expectThrows(() => toolCreateTask(rest, "s1", layer))
  })
})
