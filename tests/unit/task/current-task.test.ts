import { beforeEach, describe, expect, test } from "bun:test"
import { currentTask } from "@logbook/task/current-task.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { SessionRegistry } from "@logbook/task/session-registry.js"
import { Effect, Layer } from "effect"
import { makeAgent, makeTask } from "../../helpers/factories.js"
import { InMemorySessionRegistry } from "../../helpers/in-memory-session-registry.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"

const makeLayer = (repo: InMemoryTaskRepository, sessions = new InMemorySessionRegistry()) =>
  Layer.merge(Layer.succeed(TaskRepository, repo), Layer.succeed(SessionRegistry, sessions))

const runWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository | SessionRegistry>,
  repo: InMemoryTaskRepository,
  sessions = new InMemorySessionRegistry()
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer(repo, sessions)) as Effect.Effect<A, never>)

const runFailWith = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository | SessionRegistry>,
  repo: InMemoryTaskRepository,
  sessions = new InMemorySessionRegistry()
): Promise<{ _tag: string; [k: string]: unknown }> =>
  Effect.runPromise(
    Effect.provide(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(e as { _tag: string }),
          onSuccess: () => Effect.die(new Error("Expected failure")),
        })
      ),
      makeLayer(repo, sessions)
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

describe("currentTask / step 1 — own in_progress", () => {
  test("returns highest-priority in_progress task for session", async () => {
    const agent = makeAgent({ id: "session-1" })
    const highPriority = await seedTask(repo, {
      id: "t-high",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T09:00:00Z"),
      priority: 5,
    })
    await seedTask(repo, {
      id: "t-low",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
      priority: 1,
    })
    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(highPriority.id)
  })

  test("tie-break by in_progress_since ASC when priorities are equal", async () => {
    const agent = makeAgent({ id: "session-1" })
    const older = await seedTask(repo, {
      id: "t-old",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
      priority: 0,
    })
    await seedTask(repo, {
      id: "t-new",
      status: "in_progress",
      assignee: agent,
      in_progress_since: new Date("2026-01-01T09:00:00Z"),
      priority: 0,
    })
    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(older.id)
  })

  test("happy path multi-agent: session sees only its own task among live sessions", async () => {
    const sessions = new InMemorySessionRegistry()
    for (let i = 1; i <= 5; i++) sessions.setAlive(`session-${i}`, true)

    for (let i = 1; i <= 5; i++) {
      await seedTask(repo, {
        id: `task-${i}`,
        status: "in_progress",
        assignee: makeAgent({ id: `session-${i}` }),
        in_progress_since: new Date(`2026-01-01T0${i}:00:00Z`),
      })
    }

    const task = await runWith(currentTask("session-3"), repo, sessions)
    expect(task.id).toBe("task-3")
    expect(task.assignee?.id).toBe("session-3")
  })
})

describe("currentTask / step 2 — unassigned in_progress", () => {
  test("claims highest-priority unassigned in_progress task", async () => {
    const highPriority = await seedTask(repo, {
      id: "unassigned-high",
      status: "in_progress",
      assignee: undefined,
      in_progress_since: new Date("2026-01-01T09:00:00Z"),
      priority: 10,
    })
    await seedTask(repo, {
      id: "unassigned-low",
      status: "in_progress",
      assignee: undefined,
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
      priority: 1,
    })

    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(highPriority.id)
    expect(task.assignee?.id).toBe("session-1")
  })

  test("claimed task is persisted in the repo", async () => {
    await seedTask(repo, {
      id: "unassigned-1",
      status: "in_progress",
      assignee: undefined,
    })

    await runWith(currentTask("session-1"), repo)
    const persisted = repo.inspect().find((t) => t.id === "unassigned-1")
    expect(persisted?.assignee?.id).toBe("session-1")
  })
})

describe("currentTask / step 3 — orphaned in_progress", () => {
  test("sessions are isolated: agent-2 does not see alive agent-1's task", async () => {
    const sessions = new InMemorySessionRegistry()
    sessions.setAlive("session-1", true)
    const agent1 = makeAgent({ id: "session-1" })
    await seedTask(repo, {
      status: "in_progress",
      assignee: agent1,
      in_progress_since: new Date(),
    })
    const err = await runFailWith(currentTask("session-2"), repo, sessions)
    expect(err._tag).toBe("no_current_task")
  })

  test("orphan recovery: claims oldest dead-session task", async () => {
    const sessions = new InMemorySessionRegistry()
    for (let i = 1; i <= 4; i++) sessions.setAlive(`session-${i}`, true)

    for (let i = 1; i <= 5; i++) {
      await seedTask(repo, {
        id: `task-${i}`,
        status: "in_progress",
        assignee: makeAgent({ id: `session-${i}` }),
        in_progress_since: new Date(`2026-01-01T0${i}:00:00Z`),
      })
    }

    const task = await runWith(currentTask("session-6"), repo, sessions)
    expect(task.id).toBe("task-5")
    expect(task.assignee?.id).toBe("session-6")
  })

  test("orphan recovery: preserves original assignee title and description", async () => {
    const sessions = new InMemorySessionRegistry()
    await seedTask(repo, {
      id: "orphan-task",
      status: "in_progress",
      assignee: makeAgent({ id: "dead-session", title: "Specialist", description: "Expert agent" }),
      in_progress_since: new Date(),
    })

    const task = await runWith(currentTask("session-new"), repo, sessions)
    expect(task.assignee?.id).toBe("session-new")
    expect(task.assignee?.title).toBe("Specialist")
    expect(task.assignee?.description).toBe("Expert agent")
  })

  test("multiple orphans: selects the highest-priority orphan", async () => {
    const sessions = new InMemorySessionRegistry()

    await seedTask(repo, {
      id: "task-low",
      status: "in_progress",
      assignee: makeAgent({ id: "session-A" }),
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
      priority: 1,
    })
    await seedTask(repo, {
      id: "task-high",
      status: "in_progress",
      assignee: makeAgent({ id: "session-B" }),
      in_progress_since: new Date("2026-01-01T10:00:00Z"),
      priority: 7,
    })

    const task = await runWith(currentTask("session-new"), repo, sessions)
    expect(task.id).toBe("task-high")
    expect(task.assignee?.id).toBe("session-new")
  })

  test("multiple orphans: tie-break by in_progress_since ASC", async () => {
    const sessions = new InMemorySessionRegistry()

    await seedTask(repo, {
      id: "task-newer",
      status: "in_progress",
      assignee: makeAgent({ id: "session-A" }),
      in_progress_since: new Date("2026-01-01T10:00:00Z"),
      priority: 0,
    })
    await seedTask(repo, {
      id: "task-oldest",
      status: "in_progress",
      assignee: makeAgent({ id: "session-B" }),
      in_progress_since: new Date("2026-01-01T08:00:00Z"),
      priority: 0,
    })

    const task = await runWith(currentTask("session-new"), repo, sessions)
    expect(task.id).toBe("task-oldest")
    expect(task.assignee?.id).toBe("session-new")
  })

  test("no orphans available (all other sessions alive) → falls through to step 4", async () => {
    const sessions = new InMemorySessionRegistry()
    sessions.setAlive("session-1", true)
    await seedTask(repo, {
      status: "in_progress",
      assignee: makeAgent({ id: "session-1" }),
      in_progress_since: new Date(),
    })
    // No todo tasks either → no_current_task
    const err = await runFailWith(currentTask("session-2"), repo, sessions)
    expect(err._tag).toBe("no_current_task")
  })
})

describe("currentTask / step 4 — todo auto-claim", () => {
  test("todo task is claimed as in_progress when no in_progress tasks exist", async () => {
    const todo = await seedTask(repo, { id: "todo-1", status: "todo" })

    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(todo.id)
    expect(task.status).toBe("in_progress")
    expect(task.assignee?.id).toBe("session-1")
    expect(task.in_progress_since).toBeDefined()
  })

  test("claimed todo is persisted in the repo with updated status", async () => {
    await seedTask(repo, { id: "todo-1", status: "todo" })

    await runWith(currentTask("session-1"), repo)
    const persisted = repo.inspect().find((t) => t.id === "todo-1")
    expect(persisted?.status).toBe("in_progress")
    expect(persisted?.assignee?.id).toBe("session-1")
  })

  test("highest-priority todo is claimed", async () => {
    await seedTask(repo, { id: "todo-low", status: "todo", priority: 1 })
    const high = await seedTask(repo, { id: "todo-high", status: "todo", priority: 5 })

    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(high.id)
  })

  test("todo tie-break: first in insertion order when priorities are equal", async () => {
    const first = await seedTask(repo, { id: "todo-first", status: "todo", priority: 0 })
    await seedTask(repo, { id: "todo-second", status: "todo", priority: 0 })

    const task = await runWith(currentTask("session-1"), repo)
    expect(task.id).toBe(first.id)
  })

  test("step 3 → step 4 fallthrough: all in_progress are alive, todo is claimed", async () => {
    const sessions = new InMemorySessionRegistry()
    sessions.setAlive("session-alive", true)
    await seedTask(repo, {
      status: "in_progress",
      assignee: makeAgent({ id: "session-alive" }),
      in_progress_since: new Date(),
    })
    await seedTask(repo, { id: "todo-task", status: "todo" })

    const task = await runWith(currentTask("session-new"), repo, sessions)
    expect(task.id).toBe("todo-task")
    expect(task.status).toBe("in_progress")
  })
})

describe("currentTask / step 5 — nothing available", () => {
  test("no in_progress, no todo → no_current_task", async () => {
    await seedTask(repo, { status: "backlog" })
    const err = await runFailWith(currentTask("session-1"), repo)
    expect(err._tag).toBe("no_current_task")
  })

  test("empty repo → no_current_task", async () => {
    const err = await runFailWith(currentTask("session-1"), repo)
    expect(err._tag).toBe("no_current_task")
  })
})
