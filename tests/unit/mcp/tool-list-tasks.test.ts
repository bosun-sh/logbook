import { beforeEach, describe, expect, test } from "bun:test"
import { toolListTasks } from "@logbook/mcp/tool-list-tasks.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

let repo: InMemoryTaskRepository
let layer: Layer.Layer<TaskRepository>

const seed = async (...overrides: Parameters<typeof makeTask>[0][]) => {
  for (const override of overrides) {
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(TaskRepository, (r) => r.save(makeTask(override))),
        layer
      ) as Effect.Effect<void, never>
    )
  }
}

beforeEach(() => {
  repo = new InMemoryTaskRepository()
  layer = Layer.succeed(TaskRepository, repo)
})

describe("toolListTasks / happy path", () => {
  test("returns only tasks matching the requested status", async () => {
    await seed(
      { status: "backlog" },
      { status: "todo" },
      { status: "in_progress", in_progress_since: new Date() }
    )
    const result = await toolListTasks({ status: "backlog" }, layer)
    expect(result.tasks.length).toBe(1)
    const task = result.tasks[0] as Record<string, unknown>
    expect(task.status).toBe("backlog")
  })

  test("returns [] when no tasks match status", async () => {
    await seed({ status: "backlog" })
    const result = await toolListTasks({ status: "done" }, layer)
    expect(result.tasks).toEqual([])
  })

  test("'*' status returns all tasks", async () => {
    await seed({ status: "backlog" }, { status: "todo" }, { status: "done" })
    const result = await toolListTasks({ status: "*" }, layer)
    expect(result.tasks.length).toBe(3)
  })

  test("defaults to in_progress when status is omitted", async () => {
    await seed({ status: "in_progress", in_progress_since: new Date() }, { status: "backlog" })
    const result = await toolListTasks({}, layer)
    expect(result.tasks.length).toBe(1)
    const task = result.tasks[0] as Record<string, unknown>
    expect(task.status).toBe("in_progress")
  })

  test("returns multiple tasks with matching status", async () => {
    await seed(
      { status: "in_progress", in_progress_since: new Date() },
      { status: "in_progress", in_progress_since: new Date() },
      { status: "backlog" }
    )
    const result = await toolListTasks({ status: "in_progress" }, layer)
    expect(result.tasks.length).toBe(2)
    expect(
      (result.tasks as Record<string, unknown>[]).every((t) => t.status === "in_progress")
    ).toBe(true)
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

describe("toolListTasks / Zod validation rejects", () => {
  test("invalid status value → throws ZodError", async () => {
    await expectThrows(() => toolListTasks({ status: "invalid_status" }, layer))
  })

  test("status as number → throws ZodError", async () => {
    await expectThrows(() => toolListTasks({ status: 123 }, layer))
  })
})
