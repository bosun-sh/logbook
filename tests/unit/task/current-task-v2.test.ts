import { describe, expect, test } from "bun:test"
import type { Assignment } from "@logbook/shared/schema/value-objects.js"
import { type GetCurrentTaskInput, getCurrentTask } from "@logbook/task/current.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { SessionLivenessPort } from "@logbook/workspace/session-liveness.js"
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

class InMemorySessionLivenessPort {
  private readonly liveness = new Map<string, boolean>()

  setAlive(sessionId: string, alive: boolean) {
    this.liveness.set(sessionId, alive)
  }

  isAlive(sessionId: string) {
    return Effect.succeed(this.liveness.get(sessionId) ?? false)
  }
}

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-08T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-08T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const makeLayer = (repo: InMemoryTaskRepository, sessions = new InMemorySessionLivenessPort()) =>
  Layer.mergeAll(
    Layer.succeed(TaskRepository, repo as unknown as TaskRepositoryPort),
    Layer.succeed(SessionLivenessPort, sessions)
  )

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-08",
  title: "Current task claiming",
  description: "Claim current task candidates",
  definitionOfDone: "Current task behavior passes",
  status: "todo",
  priority: 0,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 1,
    complexity: "small",
    fibonacci: 2,
    confidence: "high",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

const seed = async (repo: InMemoryTaskRepository, ...tasks: Task[]) => {
  await run(Effect.all(tasks.map((task) => repo.save(task))))
}

const runCurrentTask = (
  input: GetCurrentTaskInput,
  repo: InMemoryTaskRepository,
  sessions = new InMemorySessionLivenessPort()
) =>
  run(
    Effect.provide(Effect.withClock(fixedClock)(getCurrentTask(input)), makeLayer(repo, sessions))
  )

describe("task v2 current task use case", () => {
  test("returns the best own in_progress task before other buckets", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      makeTask({
        id: "task-own-high",
        status: "in_progress",
        sessionId: "session-1",
        priority: 5,
        updatedAt: "2026-01-07T00:00:00.000Z",
      }),
      makeTask({
        id: "task-own-low",
        status: "in_progress",
        sessionId: "session-1",
        priority: 4,
        updatedAt: "2026-01-08T00:00:00.000Z",
      }),
      makeTask({
        id: "task-unassigned",
        status: "in_progress",
        priority: 99,
        updatedAt: "2026-01-08T00:00:00.000Z",
      }),
      makeTask({
        id: "task-dead",
        status: "in_progress",
        sessionId: "dead-session",
        priority: 99,
        updatedAt: "2026-01-08T00:00:00.000Z",
      }),
      makeTask({
        id: "task-todo",
        status: "todo",
        priority: 99,
        updatedAt: "2026-01-08T00:00:00.000Z",
      })
    )

    const sessions = new InMemorySessionLivenessPort()
    sessions.setAlive("dead-session", false)

    const result = await runCurrentTask({ sessionId: "session-1" }, repo, sessions)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected own task to resolve")
    }

    expect(result.data.task.id).toBe("task-own-high")
    expect(result.data.task.sessionId).toBe("session-1")
    expect(result.data.claimed).toBe(false)
    expect(result.data.promoted).toBe(false)
  })

  test("claims the best unassigned in_progress task and updates assignment fields atomically", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      makeTask({
        id: "task-b",
        status: "in_progress",
        priority: 3,
        updatedAt: "2026-01-05T00:00:00.000Z",
        inProgressSince: "2026-01-02T00:00:00.000Z",
      }),
      makeTask({
        id: "task-a",
        status: "in_progress",
        priority: 3,
        updatedAt: "2026-01-05T00:00:00.000Z",
        inProgressSince: "2026-01-03T00:00:00.000Z",
      })
    )

    const assignee: Assignment = {
      id: "ignored-input-id",
      title: "Planner",
      description: "Primary operator",
    }

    const result = await runCurrentTask(
      { sessionId: "session-2", assignee } satisfies GetCurrentTaskInput,
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected claim to succeed")
    }

    expect(result.data.claimed).toBe(true)
    expect(result.data.promoted).toBe(false)
    expect(result.data.task.id).toBe("task-a")
    expect(result.data.task.sessionId).toBe("session-2")
    expect(result.data.task.assignee).toEqual({
      id: "session-2",
      title: "Planner",
      description: "Primary operator",
    })
    expect(result.data.task.updatedAt).toBe("2026-01-08T12:34:56.789Z")
    expect(result.data.task.inProgressSince).toBe("2026-01-03T00:00:00.000Z")

    const persisted = await run(repo.findById("task-a"))
    expect(persisted).toEqual(result.data.task)
  })

  test("reclaims the best dead-session in_progress task when no own or unassigned task exists", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      makeTask({
        id: "task-c",
        status: "in_progress",
        sessionId: "alive-session",
        priority: 10,
        updatedAt: "2026-01-07T00:00:00.000Z",
      }),
      makeTask({
        id: "task-b",
        status: "in_progress",
        sessionId: "dead-session",
        priority: 7,
        updatedAt: "2026-01-07T00:00:00.000Z",
      }),
      makeTask({
        id: "task-a",
        status: "in_progress",
        sessionId: "unknown-session",
        priority: 7,
        updatedAt: "2026-01-07T00:00:00.000Z",
      })
    )

    const sessions = new InMemorySessionLivenessPort()
    sessions.setAlive("alive-session", true)
    sessions.setAlive("dead-session", false)

    const result = await runCurrentTask({ sessionId: "session-3" }, repo, sessions)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected dead-session claim to succeed")
    }

    expect(result.data.task.id).toBe("task-a")
    expect(result.data.task.status).toBe("in_progress")
    expect(result.data.task.sessionId).toBe("session-3")
    expect(result.data.task.updatedAt).toBe("2026-01-08T12:34:56.789Z")
    expect(result.data.claimed).toBe(true)
    expect(result.data.promoted).toBe(false)
  })

  test("promotes the best todo task when no in_progress candidate exists and excludes need_info", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      makeTask({
        id: "task-need-info",
        status: "need_info",
        sessionId: "session-old",
        priority: 100,
        updatedAt: "2026-01-08T00:00:00.000Z",
      }),
      makeTask({
        id: "task-b",
        status: "todo",
        priority: 9,
        updatedAt: "2026-01-07T00:00:00.000Z",
      }),
      makeTask({
        id: "task-a",
        status: "todo",
        priority: 9,
        updatedAt: "2026-01-07T00:00:00.000Z",
      })
    )

    const result = await runCurrentTask({ sessionId: "session-4" }, repo)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected todo promotion to succeed")
    }

    expect(result.data.task.id).toBe("task-a")
    expect(result.data.task.status).toBe("in_progress")
    expect(result.data.task.sessionId).toBe("session-4")
    expect(result.data.task.inProgressSince).toBe("2026-01-08T12:34:56.789Z")
    expect(result.data.task.updatedAt).toBe("2026-01-08T12:34:56.789Z")
    expect(result.data.claimed).toBe(true)
    expect(result.data.promoted).toBe(true)
  })

  test("returns no_current_task when only need_info tasks remain", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      makeTask({
        id: "task-need-info",
        status: "need_info",
        sessionId: "session-old",
        priority: 100,
        updatedAt: "2026-01-08T00:00:00.000Z",
      })
    )

    const result = await runCurrentTask({ sessionId: "session-5" }, repo)

    expect(result).toEqual({
      ok: false,
      error: {
        code: "no_current_task",
        message: "No current task for this session",
      },
    })
  })

  test("returns storage_error when the candidate scan exceeds 100000 records", async () => {
    const repo = new InMemoryTaskRepository()
    await seed(
      repo,
      ...Array.from({ length: 100_001 }, (_, index) =>
        makeTask({
          id: `task_${String(index).padStart(32, "0")}`,
          status: "in_progress",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })
      )
    )

    const result = await runCurrentTask({ sessionId: "session-6" }, repo)

    expect(result).toEqual({
      ok: false,
      error: {
        code: "storage_error",
        message: "current-task candidate scan exceeded 100000 records",
      },
    })
  })
})
