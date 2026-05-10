import { beforeEach, describe, expect, test } from "bun:test"
import { assignTaskModel } from "@logbook/task/model-assignment.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { Clock, Effect, Layer } from "effect"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

class InMemoryTaskRepository implements TaskRepositoryShape {
  private readonly store = new Map<string, Task>()

  findById(id: string) {
    const task = this.store.get(id)
    if (task === undefined) {
      return Effect.fail({ _tag: "not_found", message: `task ${id} was not found`, id })
    }

    return Effect.succeed(task)
  }

  findByStatus(status: Task["status"] | "*") {
    const tasks = [...this.store.values()]
    return Effect.succeed(status === "*" ? tasks : tasks.filter((task) => task.status === status))
  }

  save(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }
}

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-10T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-10T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_446_496_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_446_496_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const makeLayer = (repo: InMemoryTaskRepository) =>
  Layer.succeed(TaskRepository, repo as unknown as TaskRepositoryPort)

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-15",
  title: "Assign task model",
  description: "Assign a default model",
  definitionOfDone: "Model assignment works",
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

beforeEach(() => {
  // Each test creates its own repository.
})

describe("assignTaskModel", () => {
  test("updates the task default model and validates the full task schema", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          assignTaskModel({
            id: task.id,
            model: {
              id: "gpt-5.4-mini",
              provider: "openai",
              reason: "default task model",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected model assignment to succeed")
    }

    expect(result.data.task.model).toEqual({
      id: "gpt-5.4-mini",
      provider: "openai",
      reason: "default task model",
    })
    expect(result.data.task.updatedAt).toBe("2026-01-10T12:34:56.789Z")
    expect(() => TaskSchema.parse(result.data.task)).not.toThrow()

    const persisted = await run(repo.findById(task.id))
    expect(persisted).toEqual(result.data.task)
  })

  test("rejects model ids longer than 256 bytes", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          assignTaskModel({
            id: task.id,
            model: {
              id: "a".repeat(257),
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected model assignment to fail")
    }

    expect(result.error.code).toBe("validation_error")
    expect(await run(repo.findById(task.id))).toEqual(task)
  })

  test("returns not_found for an unknown task id", async () => {
    const repo = new InMemoryTaskRepository()

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          assignTaskModel({
            id: "task_missing",
            model: {
              id: "gpt-5.4-mini",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected model assignment to fail")
    }

    expect(result.error.code).toBe("not_found")
  })
})
