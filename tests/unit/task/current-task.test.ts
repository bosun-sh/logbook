import { beforeEach, describe, expect, test } from "bun:test"
import { currentTask } from "@logbook/task/current-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeAgent, makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

const makeLayer = (repo: InMemoryTaskRepository) => Layer.succeed(TaskRepository, repo)

const runWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer(repo)) as Effect.Effect<A, never>)

const runFailWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository
): Promise<{ _tag: string; [k: string]: unknown }> =>
  Effect.runPromise(
    Effect.provide(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(e as { _tag: string }),
          onSuccess: () => Effect.die(new Error("Expected failure")),
        })
      ),
      makeLayer(repo)
    ) as Effect.Effect<{ _tag: string }, never>
  )

const seedTask = async (
  repo: InMemoryTaskRepository,
  overrides: Parameters<typeof makeTask>[0]
) => {
  const layer = makeLayer(repo)
  const task = makeTask(overrides)
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(TaskRepository, (r) => r.save(task)),
      layer
    ) as Effect.Effect<void, never>
  )
  return task
}

let repo: InMemoryTaskRepository

beforeEach(() => {
  repo = new InMemoryTaskRepository()
})

describe("currentTask", () => {
  test("returns oldest in_progress task for session (FIFO)", async () => {
    const agent = makeAgent({ id: "session-1" })
    const older = await seedTask(repo, {
      id: "t-old",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
    })
    await seedTask(repo, {
      id: "t-new",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T09:00:00Z"),
    })
    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(older.id)
  })

  test("no in_progress tasks → no_current_task", async () => {
    await seedTask(repo, { status: "backlog" })
    const err = await runFailWith(currentTask("session-1"), repo)
    expect(err._tag).toBe("no_current_task")
  })

  test("sessions are isolated: agent-2 does not see agent-1's task", async () => {
    const agent1 = makeAgent({ id: "session-1" })
    await seedTask(repo, {
      status: "in_progress",
      assignee: agent1,
      in_progress_since: new Date(),
    })
    const err = await runFailWith(currentTask("session-2"), repo)
    expect(err._tag).toBe("no_current_task")
  })
})
