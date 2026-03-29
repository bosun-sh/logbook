import { beforeEach, describe, expect, test } from "bun:test"
import { editTask } from "@logbook/task/edit-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

type AnyError = { _tag: string; [k: string]: unknown }

let repo: InMemoryTaskRepository

const makeLayer = () => Layer.succeed(TaskRepository, repo)

const run = <A>(effect: Effect.Effect<A, unknown, TaskRepository>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer()) as Effect.Effect<A, never>)

const runFail = <A>(effect: Effect.Effect<A, unknown, TaskRepository>): Promise<AnyError> =>
  Effect.runPromise(
    Effect.provide(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(e as AnyError),
          onSuccess: () => Effect.die(new Error("Expected failure")),
        })
      ),
      makeLayer()
    ) as Effect.Effect<AnyError, never>
  )

const seedTask = async (overrides: Parameters<typeof makeTask>[0] = {}) => {
  const task = makeTask(overrides)
  await run(Effect.flatMap(TaskRepository, (r) => r.save(task)))
  return task
}

beforeEach(() => {
  repo = new InMemoryTaskRepository()
})

describe("editTask / happy path", () => {
  test("edits title; status unchanged", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const updated = await run(editTask(task.id, { title: "New Title" }))
    expect(updated.title).toBe("New Title")
    expect(updated.status).toBe(task.status)
  })

  test("edits description", async () => {
    const task = await seedTask()
    const updated = await run(editTask(task.id, { description: "Updated desc" }))
    expect(updated.description).toBe("Updated desc")
  })

  test("edits definition_of_done", async () => {
    const task = await seedTask()
    const updated = await run(editTask(task.id, { definition_of_done: "New DoD" }))
    expect(updated.definition_of_done).toBe("New DoD")
  })

  // 8 kTokens → ratio=2.5, scaled=3.2, nearest Fibonacci=3
  test("edits estimation via predictedKTokens mapping", async () => {
    const task = await seedTask()
    const updated = await run(editTask(task.id, { predictedKTokens: 8 }))
    expect(updated.estimation).toBe(3)
  })
})

describe("editTask / error cases", () => {
  test("not_found for unknown id", async () => {
    const err = await runFail(editTask("ghost-id", { title: "X" }))
    expect(err._tag).toBe("not_found")
  })

  test("predictedKTokens exceeding max → validation_error", async () => {
    const task = await seedTask()
    const err = await runFail(editTask(task.id, { predictedKTokens: 25 }))
    expect(err).toMatchObject({
      _tag: "validation_error",
      message: "predicted kilotokens exceed maximum allowed",
    })
  })

  test("attempting to set status field → validation_error", async () => {
    const task = await seedTask()
    // Cast to defeat the type system — simulates what happens at a system boundary
    const err = await runFail(editTask(task.id, { status: "done" } as never))
    expect(err._tag).toBe("validation_error")
  })
})
