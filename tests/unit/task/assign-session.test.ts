import { beforeEach, describe, expect, test } from "bun:test"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { assignTaskSession, clearTaskSession } from "@logbook/task/session-assignment.js"
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
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-09T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-09T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_360_096_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_360_096_789_000_000n),
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
  milestone: "task-14",
  title: "Session assignment",
  description: "Assign task sessions",
  definitionOfDone: "Session assignment works",
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

const seed = async (repo: InMemoryTaskRepository, ...tasks: Task[]) => {
  await run(Effect.all(tasks.map((task) => repo.save(task))))
}

const runAssign = (
  input: Parameters<typeof assignTaskSession>[0],
  repo: InMemoryTaskRepository,
  sessions = new InMemorySessionLivenessPort()
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(assignTaskSession(input)),
      makeLayer(repo, sessions)
    )
  )

const runClear = (input: Parameters<typeof clearTaskSession>[0], repo: InMemoryTaskRepository) =>
  run(Effect.provide(Effect.withClock(fixedClock)(clearTaskSession(input)), makeLayer(repo)))

let repo: InMemoryTaskRepository

beforeEach(() => {
  repo = new InMemoryTaskRepository()
})

describe("assignTaskSession", () => {
  test("assigns an unassigned task to a session and records display data", async () => {
    const task = makeTask({ id: "task-unassigned", assignee: undefined, sessionId: undefined })
    await seed(repo, task)

    const result = await runAssign(
      {
        id: task.id,
        sessionId: "session-1",
        assignee: {
          id: "ignored",
          title: "Planner",
          description: "Primary operator",
        },
      },
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected assignment to succeed")
    }

    expect(result.data.task.sessionId).toBe("session-1")
    expect(result.data.task.assignee).toEqual({
      id: "session-1",
      title: "Planner",
      description: "Primary operator",
    })
    expect(result.data.task.updatedAt).toBe("2026-01-09T12:34:56.789Z")
    expect(result.data.task.comments).toHaveLength(0)

    const persisted = await run(repo.findById(task.id))
    expect(persisted).toEqual(result.data.task)
  })

  test("conflicting reassignment to a live session returns assignment_conflict", async () => {
    const task = makeTask({
      id: "task-live",
      sessionId: "session-old",
      assignee: {
        id: "session-old",
        title: "Specialist",
        description: "Existing operator",
      },
    })
    await seed(repo, task)

    const sessions = new InMemorySessionLivenessPort()
    sessions.setAlive("session-old", true)

    const result = await runAssign(
      {
        id: task.id,
        sessionId: "session-new",
      },
      repo,
      sessions
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected assignment to fail")
    }

    expect(result.error.code).toBe("assignment_conflict")
    expect(result.error.details).toEqual({
      id: task.id,
      sessionId: "session-old",
    })

    const persisted = await run(repo.findById(task.id))
    expect(persisted).toEqual(task)
  })

  test("reassignment from a dead session appends an audit comment and preserves history", async () => {
    const task = makeTask({
      id: "task-dead",
      sessionId: "session-old",
      assignee: {
        id: "session-old",
        title: "Specialist",
        description: "Existing operator",
      },
    })
    await seed(repo, task)

    const sessions = new InMemorySessionLivenessPort()
    sessions.setAlive("session-old", false)

    const result = await runAssign(
      {
        id: task.id,
        sessionId: "session-new",
        reason: "taking over after session expiry",
      },
      repo,
      sessions
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected reassignment to succeed")
    }

    expect(result.data.task.sessionId).toBe("session-new")
    expect(result.data.task.assignee).toEqual(task.assignee)
    expect(result.data.task.comments).toHaveLength(1)
    expect(result.data.task.comments[0]).toMatchObject({
      kind: "sync",
      title: "Session reassignment",
    })
    expect(result.data.task.comments[0]?.content).toContain("session-old")
    expect(result.data.task.comments[0]?.content).toContain("session-new")
    expect(result.data.task.comments[0]?.content).toContain("taking over after session expiry")
  })

  test("rejects oversized assignment display data with validation_error", async () => {
    const task = makeTask({ id: "task-oversized", assignee: undefined, sessionId: undefined })
    await seed(repo, task)

    const result = await runAssign(
      {
        id: task.id,
        sessionId: "session-1",
        assignee: {
          id: "ignored",
          title: "x".repeat(513),
        },
      },
      repo
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected validation to fail")
    }

    expect(result.error.code).toBe("validation_error")
  })

  test("rejects oversized audit content with validation_error", async () => {
    const task = makeTask({
      id: "task-comment-limit",
      sessionId: "session-old",
      assignee: {
        id: "session-old",
        title: "Specialist",
      },
    })
    await seed(repo, task)

    const sessions = new InMemorySessionLivenessPort()
    sessions.setAlive("session-old", false)

    const result = await runAssign(
      {
        id: task.id,
        sessionId: "session-new",
        reason: "x".repeat(65_537),
      },
      repo,
      sessions
    )

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected validation to fail")
    }

    expect(result.error.code).toBe("validation_error")
  })
})

describe("clearTaskSession", () => {
  test("clears the session assignment and records an audit comment", async () => {
    const task = makeTask({
      id: "task-clear",
      sessionId: "session-old",
      assignee: {
        id: "session-old",
        title: "Specialist",
      },
    })
    await seed(repo, task)

    const result = await runClear(
      {
        id: task.id,
        reason: "task completed elsewhere",
      },
      repo
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected clear to succeed")
    }

    expect(result.data.task.sessionId).toBeUndefined()
    expect(result.data.task.assignee).toEqual(task.assignee)
    expect(result.data.task.comments).toHaveLength(1)
    expect(result.data.task.comments[0]?.kind).toBe("sync")
    expect(result.data.task.comments[0]?.content).toContain("session-old")
    expect(result.data.task.comments[0]?.content).toContain("task completed elsewhere")
  })
})
