import { beforeEach, describe, expect, test } from "bun:test"
import { listTasks } from "@logbook/task/list-tasks.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Effect, Layer } from "effect"
import { makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

const makeLayer = (repo: InMemoryTaskRepository) => Layer.succeed(TaskRepository, repo)

const runWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository>,
  repo: InMemoryTaskRepository
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer(repo)) as Effect.Effect<A, never>)

const seed = async (repo: InMemoryTaskRepository, ...tasks: Parameters<typeof makeTask>[0][]) => {
  const layer = makeLayer(repo)
  for (const overrides of tasks) {
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(TaskRepository, (r) => r.save(makeTask(overrides))),
        layer
      ) as Effect.Effect<void, never>
    )
  }
}

let repo: InMemoryTaskRepository

beforeEach(() => {
  repo = new InMemoryTaskRepository()
})

describe("listTasks", () => {
  test("returns only tasks matching status", async () => {
    await seed(repo, { status: "backlog" }, { status: "todo" }, { status: "in_progress" })
    const result = await runWith(listTasks({ status: "backlog" }), repo)
    expect(result.length).toBe(1)
    expect(result[0]?.status).toBe("backlog")
  })

  test("returns [] when no tasks match", async () => {
    await seed(repo, { status: "backlog" })
    const result = await runWith(listTasks({ status: "done" }), repo)
    expect(result).toEqual([])
  })

  test("'*' returns all tasks across all statuses", async () => {
    await seed(repo, { status: "backlog" }, { status: "todo" }, { status: "done" })
    const result = await runWith(listTasks({ status: "*" }), repo)
    expect(result.length).toBe(3)
  })

  test("'in_progress' correctly filters", async () => {
    await seed(
      repo,
      { status: "in_progress", in_progress_since: new Date() },
      { status: "in_progress", in_progress_since: new Date() },
      { status: "backlog" }
    )
    const result = await runWith(listTasks({ status: "in_progress" }), repo)
    expect(result.length).toBe(2)
    expect(result.every((t) => t.status === "in_progress")).toBe(true)
  })

  test("project filter returns only tasks from the given project", async () => {
    await seed(
      repo,
      { status: "backlog", project: "alpha" },
      { status: "backlog", project: "beta" },
      { status: "backlog", project: "alpha" }
    )
    const result = await runWith(listTasks({ status: "backlog", project: "alpha" }), repo)
    expect(result.length).toBe(2)
    expect(result.every((t) => t.project === "alpha")).toBe(true)
  })

  test("milestone filter returns only tasks from the given milestone", async () => {
    await seed(
      repo,
      { status: "backlog", milestone: "m1" },
      { status: "backlog", milestone: "m2" },
      { status: "backlog", milestone: "m1" }
    )
    const result = await runWith(listTasks({ status: "backlog", milestone: "m1" }), repo)
    expect(result.length).toBe(2)
    expect(result.every((t) => t.milestone === "m1")).toBe(true)
  })

  test("project + milestone filters compose correctly", async () => {
    await seed(
      repo,
      { status: "backlog", project: "alpha", milestone: "m1" },
      { status: "backlog", project: "alpha", milestone: "m2" },
      { status: "backlog", project: "beta", milestone: "m1" }
    )
    const result = await runWith(
      listTasks({ status: "backlog", project: "alpha", milestone: "m1" }),
      repo
    )
    expect(result.length).toBe(1)
    expect(result[0]?.project).toBe("alpha")
    expect(result[0]?.milestone).toBe("m1")
  })

  test("filter with no matching tasks returns empty array", async () => {
    await seed(repo, { status: "backlog", project: "alpha" })
    const result = await runWith(listTasks({ status: "backlog", project: "nonexistent" }), repo)
    expect(result).toEqual([])
  })

  test("priority order is preserved when project filter is active", async () => {
    await seed(
      repo,
      { status: "backlog", project: "alpha", priority: 1 },
      { status: "backlog", project: "alpha", priority: 5 },
      { status: "backlog", project: "alpha", priority: 3 }
    )
    const result = await runWith(listTasks({ status: "backlog", project: "alpha" }), repo)
    expect(result.map((t) => t.priority)).toEqual([5, 3, 1])
  })
})
