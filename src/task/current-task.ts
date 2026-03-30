import { Effect } from "effect"
import type { Agent, Task, TaskError } from "../domain/types.js"
import type { TaskRepository as TaskRepositoryType } from "./ports.js"
import { TaskRepository } from "./ports.js"
import { SessionRegistry } from "./session-registry.js"

/**
 * Returns the best available task for the given session, claiming it if needed.
 *
 * Priority chain:
 *   1. Own in_progress  — already assigned to this session → return highest-priority
 *   2. Unassigned in_progress — no assignee → claim highest-priority, return
 *   3. Orphaned in_progress — dead-session assignee → claim highest-priority, return
 *   4. Highest-priority todo — auto-transition to in_progress, claim, return
 *   5. Nothing → fail `no_current_task`
 *
 * Ties in priority are broken by in_progress_since ASC (oldest first).
 * Claiming is a direct repo.update — no hooks, no HookRunner dependency.
 */
export const currentTask = (
  sessionId: string
): Effect.Effect<Task, TaskError, TaskRepository | SessionRegistry> =>
  Effect.flatMap(TaskRepository, (repo) =>
    Effect.flatMap(repo.findByStatus("in_progress"), (inProgress) => {
      const own = inProgress.filter((t) => t.assignee?.id === sessionId)
      if (own.length > 0) return Effect.succeed(pickHighestPriority(own))

      return stepUnassigned(inProgress, sessionId, repo).pipe(
        Effect.catchTag("no_current_task", () =>
          stepOrphan(sessionId, inProgress, repo).pipe(
            Effect.catchTag("no_current_task", () => stepTodo(sessionId, repo))
          )
        )
      )
    })
  )

const pickHighestPriority = <T extends Task>(tasks: readonly T[]): T => {
  const sorted = [...tasks].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const aTime = a.in_progress_since?.getTime() ?? Infinity
    const bTime = b.in_progress_since?.getTime() ?? Infinity
    return aTime - bTime
  })
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees non-empty
  return sorted[0]!
}

const claimTask = (
  task: Task,
  newAssignee: Agent,
  repo: TaskRepositoryType
): Effect.Effect<Task, TaskError, never> => {
  const claimed = { ...task, assignee: newAssignee }
  return Effect.map(repo.update(claimed), () => claimed)
}

const stepUnassigned = (
  inProgress: readonly Task[],
  sessionId: string,
  repo: TaskRepositoryType
): Effect.Effect<Task, TaskError, never> => {
  const unassigned = inProgress.filter((t) => t.assignee === undefined)
  if (unassigned.length === 0) return Effect.fail({ _tag: "no_current_task" as const })
  const oldest = pickHighestPriority(unassigned)
  return claimTask(oldest, { id: sessionId, title: "Agent", description: "" }, repo)
}

const stepOrphan = (
  sessionId: string,
  candidates: readonly Task[],
  repo: TaskRepositoryType
): Effect.Effect<Task, TaskError, SessionRegistry> => {
  const foreign = candidates.filter(
    (t): t is Task & { assignee: Agent } => t.assignee !== undefined && t.assignee.id !== sessionId
  )
  if (foreign.length === 0) return Effect.fail({ _tag: "no_current_task" as const })
  return Effect.flatMap(SessionRegistry, (registry) =>
    Effect.flatMap(
      Effect.forEach(foreign, (t) =>
        registry.isAlive(t.assignee.id).pipe(Effect.map((alive) => ({ task: t, alive })))
      ),
      (results) => {
        const orphans = results.filter((r) => !r.alive).map((r) => r.task)
        if (orphans.length === 0) return Effect.fail({ _tag: "no_current_task" as const })
        const oldest = pickHighestPriority(orphans)
        return claimTask(oldest, { ...oldest.assignee, id: sessionId }, repo)
      }
    )
  )
}

const stepTodo = (
  sessionId: string,
  repo: TaskRepositoryType
): Effect.Effect<Task, TaskError, never> =>
  Effect.flatMap(repo.findByStatus("todo"), (todos) => {
    if (todos.length === 0) return Effect.fail({ _tag: "no_current_task" as const })
    // biome-ignore lint/style/noNonNullAssertion: length guard above
    const best = [...todos].sort((a, b) => b.priority - a.priority)[0]!
    const claimed: Task = {
      ...best,
      status: "in_progress",
      assignee: {
        ...(best.assignee ?? { title: "Agent", description: "" }),
        id: sessionId,
      },
      in_progress_since: new Date(),
    }
    return Effect.map(repo.update(claimed), () => claimed)
  })
