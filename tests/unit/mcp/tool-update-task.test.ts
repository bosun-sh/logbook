import { beforeEach, describe, expect, test } from "bun:test"
import { HookRunner } from "@logbook/hook/ports.js"
import { toolUpdateTask } from "@logbook/mcp/tool-update-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"
import { SpyHookRunner } from "../../helpers/spy-hook-runner.js"

let repo: InMemoryTaskRepository
let spy: SpyHookRunner
let layer: Layer.Layer<TaskRepository | HookRunner>

const makeCurrentLayer = () =>
  Layer.merge(Layer.succeed(TaskRepository, repo), Layer.succeed(HookRunner, spy))

const seedTask = async (overrides: Parameters<typeof makeTask>[0] = {}) => {
  const task = makeTask(overrides)
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(TaskRepository, (r) => r.save(task)),
      makeCurrentLayer()
    ) as Effect.Effect<void, never>
  )
  return task
}

beforeEach(() => {
  repo = new InMemoryTaskRepository()
  spy = new SpyHookRunner()
  layer = makeCurrentLayer()
})

describe("toolUpdateTask / happy path", () => {
  test("valid status transition returns { ok: true }", async () => {
    const task = await seedTask({ status: "todo" })
    layer = makeCurrentLayer()
    const result = await toolUpdateTask(
      { id: task.id, new_status: "backlog" },
      task.assignee.id,
      layer
    )
    expect(result).toEqual({ ok: true })
  })

  test("transition with comment fires hook", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    layer = makeCurrentLayer()
    await toolUpdateTask(
      {
        id: task.id,
        new_status: "need_info",
        comment: { title: "Blocking question", content: "What does this do?", kind: "need_info" },
      },
      task.assignee.id,
      layer
    )
    expect(spy.calls.length).toBe(1)
    expect(spy.calls[0]?.new_status).toBe("need_info")
  })

  test("todo → in_progress succeeds and updates task", async () => {
    const task = await seedTask({ status: "todo" })
    layer = makeCurrentLayer()
    await toolUpdateTask({ id: task.id, new_status: "in_progress" }, task.assignee.id, layer)
    const updated = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(TaskRepository, (r) => r.findById(task.id)),
        makeCurrentLayer()
      ) as Effect.Effect<ReturnType<typeof makeTask>, never>
    )
    expect(updated.status).toBe("in_progress")
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

describe("toolUpdateTask / Zod validation rejects", () => {
  test("missing id → throws ZodError", async () => {
    await expectThrows(() => toolUpdateTask({ new_status: "todo" }, "s1", layer))
  })

  test("empty id → throws ZodError", async () => {
    await expectThrows(() => toolUpdateTask({ id: "", new_status: "todo" }, "s1", layer))
  })

  test("invalid status value → throws ZodError", async () => {
    await expectThrows(() => toolUpdateTask({ id: "task-1", new_status: "flying" }, "s1", layer))
  })

  test("missing new_status → throws ZodError", async () => {
    await expectThrows(() => toolUpdateTask({ id: "task-1" }, "s1", layer))
  })
})

describe("toolUpdateTask / domain errors bubble as rejections", () => {
  test("non-existent task id → rejects", async () => {
    await expect(
      toolUpdateTask({ id: "ghost-id", new_status: "todo" }, "s1", layer)
    ).rejects.toBeDefined()
  })

  test("invalid status transition → rejects", async () => {
    const task = await seedTask({ status: "backlog" })
    layer = makeCurrentLayer()
    await expect(
      toolUpdateTask({ id: task.id, new_status: "done" }, task.assignee.id, layer)
    ).rejects.toBeDefined()
  })
})
