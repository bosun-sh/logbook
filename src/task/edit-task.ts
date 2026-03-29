import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface EditTaskInput {
  title?:              string
  description?:        string
  definition_of_done?: string
  estimation?:         number
}

/**
 * Edits mutable fields of an existing task without changing its status.
 * Validates Fibonacci estimation when provided.
 * Fails with `not_found` for unknown id.
 * Fails with `validation_error` when a `status` field is attempted via EditTaskInput.
 */
export const editTask = (
  id: string,
  updates: EditTaskInput,
): Effect.Effect<Task, TaskError, TaskRepository> =>
  Effect.die(new Error("not implemented"))
