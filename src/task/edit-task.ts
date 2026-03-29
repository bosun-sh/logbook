import { Effect } from "effect"
import { estimateFromKTokens } from "../domain/kTokens.js"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface EditTaskInput {
  title?: string
  description?: string
  definition_of_done?: string
  predictedKTokens?: number
}

/**
 * Edits mutable fields of an existing task without changing its status.
 * Derives Fibonacci estimation from predictedKTokens when provided.
 * Fails with `not_found` for unknown id.
 * Fails with `validation_error` when a `status` field is attempted via EditTaskInput.
 */
export const editTask = (
  id: string,
  updates: EditTaskInput
): Effect.Effect<Task, TaskError, TaskRepository> => {
  // Check for attempted status modification (runtime guard against type system bypass)
  if ("status" in updates) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "status field cannot be edited",
    })
  }

  // Derive estimation from predictedKTokens if present
  if (updates.predictedKTokens !== undefined) {
    return Effect.flatMap(estimateFromKTokens(updates.predictedKTokens), (estimation) =>
      Effect.flatMap(TaskRepository, (repo) =>
        Effect.flatMap(repo.findById(id), (task) => {
          const { predictedKTokens: _, ...rest } = updates
          const updatedTask: Task = {
            ...task,
            ...rest,
            estimation,
          }
          return Effect.flatMap(repo.update(updatedTask), () => Effect.succeed(updatedTask))
        })
      )
    )
  }

  // No estimation to derive, proceed directly with find and update
  return Effect.flatMap(TaskRepository, (repo) =>
    Effect.flatMap(repo.findById(id), (task) => {
      const updatedTask: Task = {
        ...task,
        ...updates,
      }
      return Effect.flatMap(repo.update(updatedTask), () => Effect.succeed(updatedTask))
    })
  )
}
