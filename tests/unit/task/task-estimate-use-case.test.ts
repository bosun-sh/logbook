import { describe, expect, test } from "bun:test"
import { estimateTask } from "@logbook/task/estimate.js"
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

  inspect(id: string) {
    return this.store.get(id)
  }
}

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-03T09:10:11.123Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-03T09:10:11.123Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
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
  milestone: "task-16",
  title: "Implement task estimation",
  description: "Pure estimation and task update flow",
  definitionOfDone: "Task estimation works",
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

describe("estimateTask", () => {
  test("returns an estimate without updating a task when id is omitted", async () => {
    const repo = new InMemoryTaskRepository()

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          estimateTask({
            predictedKTokens: 21,
            complexity: "complex",
            confidence: "medium",
            rationale: "This needs a few integration steps.",
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected estimation to succeed")
    }

    expect(result.data.estimate.predictedKTokens).toBe(21)
    expect(result.data.estimate.complexity).toBe("complex")
    expect(result.data.estimate.confidence).toBe("medium")
    expect(result.data.estimate.rationale).toBe("This needs a few integration steps.")
    expect(result.data.task).toBeUndefined()
  })

  test("updates the task estimate and updatedAt when id is supplied", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(Effect.provide(repo.save(task), makeLayer(repo)))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          estimateTask({
            id: task.id,
            predictedKTokens: 13,
            complexity: "large",
            confidence: "high",
            rationale: "The scope is known and the work is bounded.",
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected task update to succeed")
    }

    expect(result.data.task?.id).toBe(task.id)
    expect(result.data.task?.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.task?.estimate).toEqual({
      predictedKTokens: 13,
      complexity: "large",
      fibonacci: result.data.estimate.fibonacci,
      confidence: "high",
      rationale: "The scope is known and the work is bounded.",
    })
    expect(() => TaskSchema.parse(result.data.task)).not.toThrow()

    const persisted = repo.inspect(task.id)
    expect(persisted?.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(persisted?.estimate).toEqual(result.data.estimate)
  })

  test("returns not_found when the supplied task id does not exist", async () => {
    const repo = new InMemoryTaskRepository()

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          estimateTask({
            id: "task_missing",
            predictedKTokens: 5,
            complexity: "small",
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "task task_missing was not found",
        details: {
          id: "task_missing",
        },
      },
    })
  })
})
