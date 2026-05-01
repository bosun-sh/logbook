import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import type { EditTaskInput } from "../task/edit-task.js"
import { editTask } from "../task/edit-task.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  definition_of_done: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  test_cases: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  predictedKTokens: z.number().positive().optional(),
  priority: z.number().int().min(0).optional(),
})

const normalizeStringArray = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

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
    updates.definition_of_done = normalizeStringArray(parsed.definition_of_done)
  if (parsed.test_cases !== undefined) updates.test_cases = normalizeStringArray(parsed.test_cases)
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
