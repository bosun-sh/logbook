import { Effect, Layer } from "effect"
import { describe, test, expect, beforeEach } from "bun:test"
import { listTasks } from "@logbook/task/list-tasks.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"
import { makeTask } from "../../helpers/factories.js"

const makeLayer = (repo: InMemoryTaskRepository) =>
  Layer.succeed(TaskRepository, repo)

const runWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository,
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer(repo)) as Effect.Effect<A, never>)

const seed = async (repo: InMemoryTaskRepository, ...tasks: Parameters<typeof makeTask>[0][]) => {
  const layer = makeLayer(repo)
  for (const overrides of tasks) {
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(TaskRepository, r => r.save(makeTask(overrides))),
        layer,
      ) as Effect.Effect<void, never>,
    )
  }
}

let repo: InMemoryTaskRepository

beforeEach(() => { repo = new InMemoryTaskRepository() })

describe("listTasks", () => {
  test("returns only tasks matching status", async () => {
    await seed(
      repo,
      { status: 'backlog' },
      { status: 'todo' },
      { status: 'in_progress' },
    )
    const result = await runWith(listTasks('backlog'), repo)
    expect(result.length).toBe(1)
    expect(result[0]?.status).toBe('backlog')
  })

  test("returns [] when no tasks match", async () => {
    await seed(repo, { status: 'backlog' })
    const result = await runWith(listTasks('done'), repo)
    expect(result).toEqual([])
  })

  test("'*' returns all tasks across all statuses", async () => {
    await seed(
      repo,
      { status: 'backlog' },
      { status: 'todo' },
      { status: 'done' },
    )
    const result = await runWith(listTasks('*'), repo)
    expect(result.length).toBe(3)
  })

  test("'in_progress' correctly filters", async () => {
    await seed(
      repo,
      { status: 'in_progress', in_progress_since: new Date() },
      { status: 'in_progress', in_progress_since: new Date() },
      { status: 'backlog' },
    )
    const result = await runWith(listTasks('in_progress'), repo)
    expect(result.length).toBe(2)
    expect(result.every(t => t.status === 'in_progress')).toBe(true)
  })
})
