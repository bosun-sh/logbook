import { Effect } from "effect"
import type { Status, Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

/**
 * Returns tasks matching the given status, or all tasks when status is '*'.
 * Fails with `validation_error` when the underlying data is malformed.
 */
export const listTasks = (
  status: Status | "*"
): Effect.Effect<readonly Task[], TaskError, TaskRepository> =>
  Effect.flatMap(TaskRepository, (repo) => repo.findByStatus(status))
