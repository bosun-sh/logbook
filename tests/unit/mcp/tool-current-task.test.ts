import { beforeEach, describe, expect, test } from "bun:test"
import { toolCurrentTask } from "@logbook/mcp/tool-current-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { SessionRegistry } from "@logbook/task/session-registry.js"
import { Effect, Layer } from "effect"
import { makeAgent, makeTask } from "../../helpers/factories.js"
import { InMemorySessionRegistry } from "../../helpers/in-memory-session-registry.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

let repo: InMemoryTaskRepository
let sessionRegistry: InMemorySessionRegistry
let layer: Layer.Layer<TaskRepository | SessionRegistry>

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
  sessionRegistry = new InMemorySessionRegistry()
  layer = Layer.merge(
    Layer.succeed(TaskRepository, repo),
    Layer.succeed(SessionRegistry, sessionRegistry)
  )
})

describe("toolCurrentTask / happy path", () => {
  test("returns { task } for current in_progress task", async () => {
    const agent = makeAgent({ id: "session-1" })
    await seedTask({ status: "in_progress", assignee: agent, in_progress_since: new Date() })
    const result = await toolCurrentTask("session-1", layer)
    expect(result).toHaveProperty("task")
    const task = result.task as Record<string, unknown>
    expect(task.status).toBe("in_progress")
  })

  test("returns oldest in_progress task for session (FIFO)", async () => {
    const agent = makeAgent({ id: "session-2" })
    const older = await seedTask({
      id: "t-old",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
    })
    await seedTask({
      id: "t-new",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T09:00:00Z"),
    })
    const result = await toolCurrentTask("session-2", layer)
    const task = result.task as Record<string, unknown>
    expect(task.id).toBe(older.id)
  })
})

describe("toolCurrentTask / no_current_task", () => {
  test("no in_progress tasks → rejects with no_current_task", async () => {
    await seedTask({ status: "backlog" })
    await expect(toolCurrentTask("session-1", layer)).rejects.toBeDefined()
  })

  test("in_progress task for different live session → rejects", async () => {
    const agent = makeAgent({ id: "session-other" })
    sessionRegistry.setAlive("session-other", true)
    await seedTask({ status: "in_progress", assignee: agent, in_progress_since: new Date() })
    await expect(toolCurrentTask("session-me", layer)).rejects.toBeDefined()
  })
})
