import { describe, expect, test } from "bun:test"
import type { Comment, CommentReply } from "@logbook/shared/schema/value-objects.js"
import { editTask } from "@logbook/task/edit.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { updateTaskStatus } from "@logbook/task/update.js"
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
  milestone: "task-07",
  title: "Implement task CRUD",
  description: "Adapter-free use cases",
  definitionOfDone: "Task CRUD works",
  status: "todo",
  priority: 0,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 0,
    complexity: "trivial",
    fibonacci: 1,
    confidence: "low",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: "comment_000000000000000000000000000001",
  title: "Status update",
  content: "Ready to move",
  kind: "regular",
  createdAt: "2026-01-02T00:00:00.000Z",
  replies: [],
  ...overrides,
})

describe("task v2 update/edit use cases", () => {
  test("updateTaskStatus applies lifecycle transitions and persists the updated task", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          updateTaskStatus({
            id: task.id,
            newStatus: "in_progress",
            comment: {
              content: "Starting implementation",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected transition to succeed")
    }

    expect(result.data.task.status).toBe("in_progress")
    expect(result.data.task.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.task.inProgressSince).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.task.comments).toHaveLength(1)
    expect(result.data.task.comments[0]?.kind).toBe("regular")
  })

  test("updateTaskStatus treats same-status transitions as no-ops", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask({
      status: "in_progress",
      updatedAt: "2026-01-02T00:00:00.000Z",
      inProgressSince: "2026-01-02T00:00:00.000Z",
    })
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          updateTaskStatus({
            id: task.id,
            newStatus: "in_progress",
            comment: {
              content: "This should be ignored",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result).toEqual({
      ok: true,
      data: {
        task,
      },
    })
  })

  test("updateTaskStatus appends replies without changing task status", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask({
      status: "need_info",
      comments: [
        makeComment({
          id: "comment_000000000000000000000000000009",
          kind: "need_info",
          content: "Need the failure output",
        }),
      ],
    })
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          updateTaskStatus({
            id: task.id,
            newStatus: "need_info",
            comment: {
              content: "Attached in the latest run",
              replyToCommentId: "comment_000000000000000000000000000009",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected reply append to succeed")
    }

    const reply = result.data.task.comments[0]?.replies[0] as CommentReply | undefined
    expect(result.data.task.status).toBe("need_info")
    expect(result.data.task.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(reply?.content).toBe("Attached in the latest run")
    expect(reply?.createdAt).toBe("2026-01-03T09:10:11.123Z")
  })

  test("updateTaskStatus returns lifecycle validation failures as structured errors", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask({ status: "in_progress" })
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          updateTaskStatus({
            id: task.id,
            newStatus: "need_info",
            comment: {
              content: "Missing logs",
            },
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
  })

  test("editTask updates mutable fields and refreshes updatedAt", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          editTask({
            id: task.id,
            title: "Implement task CRUD use cases",
            definitionOfReady: "Task 07 is ready",
            definitionOfDone: "Focused tests and typecheck pass",
            priority: 3,
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected edit to succeed")
    }

    expect(result.data.task.title).toBe("Implement task CRUD use cases")
    expect(result.data.task.definitionOfReady).toBe("Task 07 is ready")
    expect(result.data.task.definitionOfDone).toBe("Focused tests and typecheck pass")
    expect(result.data.task.priority).toBe(3)
    expect(result.data.task.updatedAt).toBe("2026-01-03T09:10:11.123Z")
    expect(result.data.task.status).toBe("todo")
  })

  test("editTask rejects invalid priority values", async () => {
    const repo = new InMemoryTaskRepository()
    const task = makeTask()
    await run(repo.save(task))

    const result = await run(
      Effect.provide(
        Effect.withClock(fixedClock)(
          editTask({
            id: task.id,
            priority: -1,
          })
        ),
        makeLayer(repo)
      )
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
  })
})
