import { beforeEach, describe, expect, test } from "bun:test"
import { createTask } from "@logbook/task/create-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

type AnyError = { _tag: string; [k: string]: unknown }

const makeLayer = (repo: InMemoryTaskRepository) => Layer.succeed(TaskRepository, repo)

const runWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository
): Promise<A> => {
  const layer = makeLayer(repo)
  return Effect.runPromise(Effect.provide(effect, layer) as Effect.Effect<A, never>)
}

const runFailWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository
): Promise<AnyError> => {
  const layer = makeLayer(repo)
  return Effect.runPromise(
    Effect.provide(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(e as AnyError),
          onSuccess: () => Effect.die(new Error("Expected failure")),
        })
      ),
      layer
    ) as Effect.Effect<AnyError, never>
  )
}

// 8 kTokens → ratio=2.5, scaled=3.2, nearest Fibonacci=3
const validInput = {
  project: "alpha",
  milestone: "m1",
  title: "My task",
  definition_of_done: "It passes tests",
  description: "Some description",
  predictedKTokens: 8,
}

let repo: InMemoryTaskRepository

beforeEach(() => {
  repo = new InMemoryTaskRepository()
})

describe("createTask / happy path", () => {
  test("creates task in backlog", async () => {
    const task = await runWith(createTask(validInput, "session-1"), repo)
    expect(task.status).toBe("backlog")
  })

  test("assignee.id equals sessionId", async () => {
    const task = await runWith(createTask(validInput, "session-abc"), repo)
    expect(task.assignee.id).toBe("session-abc")
  })

  test("task is retrievable via findByStatus('backlog')", async () => {
    const task = await runWith(createTask(validInput, "s1"), repo)
    const found = await runWith(
      Effect.flatMap(TaskRepository, (r) => r.findByStatus("backlog")),
      repo
    )
    expect(found.map((t) => t.id)).toContain(task.id)
  })

  test("auto-generated id is non-empty string", async () => {
    const task = await runWith(createTask(validInput, "s1"), repo)
    expect(typeof task.id).toBe("string")
    expect(task.id.length).toBeGreaterThan(0)
  })

  test("estimation derived from predictedKTokens via Fibonacci mapping", async () => {
    const task = await runWith(createTask(validInput, "s1"), repo)
    expect(task.estimation).toBe(3)
  })
})

describe("createTask / validation errors", () => {
  const requiredFields = [
    "title",
    "description",
    "definition_of_done",
    "project",
    "milestone",
  ] as const

  for (const field of requiredFields) {
    test(`missing ${field} → validation_error`, async () => {
      const input = { ...validInput, [field]: "" }
      const err = await runFailWith(createTask(input, "s1"), repo)
      expect(err._tag).toBe("validation_error")
    })
  }

  test("missing predictedKTokens → validation_error", async () => {
    const input = { ...validInput, predictedKTokens: undefined as unknown as number }
    const err = await runFailWith(createTask(input, "s1"), repo)
    expect(err._tag).toBe("validation_error")
  })

  test("predictedKTokens: 21 → validation_error (exceeds max)", async () => {
    const err = await runFailWith(createTask({ ...validInput, predictedKTokens: 21 }, "s1"), repo)
    expect(err).toMatchObject({
      _tag: "validation_error",
      message: "predicted kilotokens exceed maximum allowed",
    })
  })
})

describe("createTask / duplicate id", () => {
  test("duplicate id → conflict", async () => {
    // Create task, which saves it to the repo
    const task = await runWith(createTask(validInput, "s1"), repo)
    // Attempt to save the same task again via repo should fail with conflict
    const err = await runFailWith(
      Effect.flatMap(TaskRepository, (r) => r.save(task)),
      repo
    )
    expect(err).toMatchObject({ _tag: "conflict" })
  })
})
