import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface CreateTaskInput {
  project:            string
  milestone:          string
  title:              string
  definition_of_done: string
  description:        string
  estimation:         number
}

/**
 * Creates a new task in `backlog` status assigned to `sessionId`.
 * Validates all fields and Fibonacci estimation before persisting.
 */
export const createTask = (
  input: CreateTaskInput,
  sessionId: string,
): Effect.Effect<Task, TaskError, TaskRepository> =>
  Effect.die(new Error("not implemented"))
