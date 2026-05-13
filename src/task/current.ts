import type { ToolResult } from "@logbook/shared/result.js"
import type { Assignment } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { SessionLivenessPort } from "../workspace/session-liveness.js"
import { compareTasksForList } from "./ordering.js"
import { TaskRepository } from "./ports.js"
import type { Task } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const CURRENT_TASK_SCAN_BOUND = 100_000

export type GetCurrentTaskInput = {
  readonly sessionId: string
  readonly assignee?: Assignment | undefined
}

type GetCurrentTaskResult = {
  readonly task: Task
  readonly claimed: boolean
  readonly promoted: boolean
}

export const getCurrentTask = (
  input: GetCurrentTaskInput
): Effect.Effect<
  ToolResult<GetCurrentTaskResult>,
  never,
  TaskRepository | SessionLivenessPort | Clock.Clock
> =>
  Effect.gen(function* () {
    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const liveness = yield* SessionLivenessPort

    const inProgress = yield* readCandidates(repo, "in_progress", 0)
    if (!inProgress.ok) {
      return inProgress.error
    }

    const own = selectSorted(inProgress.tasks.filter((task) => task.sessionId === input.sessionId))
    if (own !== undefined) {
      return success(own, false, false)
    }

    const unassigned = selectSorted(inProgress.tasks.filter((task) => task.sessionId === undefined))
    if (unassigned !== undefined) {
      const claimed = yield* claimTask(repo, unassigned, input, false)
      return claimed.ok ? success(claimed.task, true, false) : claimed.error
    }

    const foreign = inProgress.tasks.filter(
      (task) => task.sessionId !== undefined && task.sessionId !== input.sessionId
    )
    const withLiveness = yield* Effect.forEach(foreign, (task) =>
      liveness.isAlive(task.sessionId ?? "").pipe(Effect.map((alive) => ({ task, alive })))
    )
    const deadSession = selectSorted(
      withLiveness.filter((entry) => !entry.alive).map((entry) => entry.task)
    )
    if (deadSession !== undefined) {
      const claimed = yield* claimTask(repo, deadSession, input, false)
      return claimed.ok ? success(claimed.task, true, false) : claimed.error
    }

    const todos = yield* readCandidates(repo, "todo", inProgress.scanned)
    if (!todos.ok) {
      return todos.error
    }

    const todo = selectSorted(todos.tasks)
    if (todo === undefined) {
      return noCurrentTask()
    }

    const claimed = yield* claimTask(repo, todo, input, true)
    return claimed.ok ? success(claimed.task, true, true) : claimed.error
  })

const readCandidates = (
  repo: TaskRepositoryShape,
  status: Task["status"],
  scannedSoFar: number
): Effect.Effect<
  | { readonly ok: true; readonly tasks: readonly Task[]; readonly scanned: number }
  | { readonly ok: false; readonly error: ToolResult<never> },
  never
> =>
  Effect.gen(function* () {
    const tasks = yield* Effect.either(repo.findByStatus(status))
    if (tasks._tag === "Left") {
      return { ok: false, error: storageError("repository operation failed") } as const
    }

    const scanned = scannedSoFar + tasks.right.length
    if (scanned > CURRENT_TASK_SCAN_BOUND) {
      return {
        ok: false,
        error: storageError(
          `current-task candidate scan exceeded ${CURRENT_TASK_SCAN_BOUND} records`
        ),
      } as const
    }

    return {
      ok: true,
      tasks: tasks.right,
      scanned,
    } as const
  })

const selectSorted = (tasks: readonly Task[]): Task | undefined =>
  [...tasks].sort(compareTasksForList)[0]

const claimTask = (
  repo: TaskRepositoryShape,
  task: Task,
  input: GetCurrentTaskInput,
  promoted: boolean
): Effect.Effect<
  | { readonly ok: true; readonly task: Task }
  | { readonly ok: false; readonly error: ToolResult<never> },
  never,
  Clock.Clock
> =>
  Effect.gen(function* () {
    const now = yield* nowIso()
    const nextTask: Task = {
      ...task,
      status: promoted ? "in_progress" : task.status,
      sessionId: input.sessionId,
      updatedAt: now,
      ...(promoted ? { inProgressSince: now } : {}),
      ...(input.assignee === undefined
        ? {}
        : {
            assignee: {
              ...input.assignee,
              id: input.sessionId,
            },
          }),
    }

    const saved = yield* Effect.either(repo.update(nextTask))
    if (saved._tag === "Left") {
      return { ok: false, error: storageError("repository operation failed") } as const
    }

    return { ok: true, task: nextTask } as const
  })

const success = (
  task: Task,
  claimed: boolean,
  promoted: boolean
): ToolResult<GetCurrentTaskResult> => ({
  ok: true,
  data: {
    task,
    claimed,
    promoted,
  },
})

const noCurrentTask = (): ToolResult<never> => ({
  ok: false,
  error: {
    code: "no_current_task",
    message: "No current task for this session",
  },
})

const storageError = (message: string): ToolResult<never> => ({
  ok: false,
  error: {
    code: "storage_error",
    message,
  },
})
