import { Effect } from "effect"
import type { Status, Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

type ListTasksOptions = {
  status: Status | "*"
  project?: string
  milestone?: string
}

const applyFilters = (tasks: readonly Task[], options: ListTasksOptions): readonly Task[] => {
  let result = tasks
  if (options.project !== undefined) {
    result = result.filter((t) => t.project === options.project)
  }
  if (options.milestone !== undefined) {
    result = result.filter((t) => t.milestone === options.milestone)
  }
  return result
}

/**
 * Returns tasks matching the given status (and optional project/milestone), or all tasks when status is '*'.
 * Filters compose: all provided filters must match.
 * Results are ordered by priority DESC.
 * Fails with `validation_error` when the underlying data is malformed.
 */
export const listTasks = (
  options: ListTasksOptions
): Effect.Effect<readonly Task[], TaskError, TaskRepository> =>
  Effect.flatMap(TaskRepository, (repo) =>
    Effect.map(repo.findByStatus(options.status), (tasks) =>
      [...applyFilters(tasks, options)].sort((a, b) => b.priority - a.priority)
    )
  )
