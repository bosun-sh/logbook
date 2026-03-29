import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

/**
 * Returns the oldest in_progress task assigned to the given session (FIFO by in_progress_since).
 * Fails with `no_current_task` when the session has no in_progress tasks.
 */
export const currentTask = (
  sessionId: string,
): Effect.Effect<Task, TaskError, TaskRepository> =>
  Effect.flatMap(TaskRepository, repo =>
    Effect.flatMap(repo.findByStatus('in_progress'), tasks => {
      const assignedTasks = tasks.filter(t => t.assignee.id === sessionId)
      const sorted = [...assignedTasks].sort((a, b) => {
        // Tasks without in_progress_since go last
        const aTime = a.in_progress_since?.getTime() ?? Infinity
        const bTime = b.in_progress_since?.getTime() ?? Infinity
        return aTime - bTime
      })
      const first = sorted[0]
      return first !== undefined
        ? Effect.succeed(first)
        : Effect.fail({ _tag: 'no_current_task' as const })
    }),
  )
