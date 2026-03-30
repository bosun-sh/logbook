import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import type { EditTaskInput } from "../task/edit-task.js"
import { editTask } from "../task/edit-task.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  definition_of_done: z.string().optional(),
  predictedKTokens: z.number().positive().optional(),
  priority: z.number().int().min(0).optional(),
})

export const toolEditTask = (
  rawInput: unknown,
  layer: Layer.Layer<TaskRepository>
): Promise<{ task: unknown }> => {
  const parsed = InputSchema.parse(rawInput)
  const { id } = parsed
  // Build updates by omitting undefined fields (exact optional property types compliance)
  const updates: EditTaskInput = {}
  if (parsed.title !== undefined) updates.title = parsed.title
  if (parsed.description !== undefined) updates.description = parsed.description
  if (parsed.definition_of_done !== undefined)
    updates.definition_of_done = parsed.definition_of_done
  if (parsed.predictedKTokens !== undefined) updates.predictedKTokens = parsed.predictedKTokens
  if (parsed.priority !== undefined) updates.priority = parsed.priority

  return Effect.runPromise(
    Effect.provide(
      Effect.either(editTask(id, updates).pipe(Effect.map((task) => ({ task })))),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
