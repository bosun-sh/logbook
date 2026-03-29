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
  Effect.die(new Error("not implemented"))
