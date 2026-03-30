import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import { createTask } from "../task/create-task.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  project: z.string().min(1),
  milestone: z.string().min(1),
  title: z.string().min(1),
  definition_of_done: z.string().min(1),
  description: z.string().min(1),
  predictedKTokens: z.number().positive(),
  priority: z.number().int().min(0).default(0),
})

export const toolCreateTask = (
  rawInput: unknown,
  sessionId: string,
  layer: Layer.Layer<TaskRepository>
): Promise<{ task: unknown }> => {
  const input = InputSchema.parse(rawInput)
  return Effect.runPromise(
    Effect.provide(
      Effect.either(createTask(input, sessionId).pipe(Effect.map((task) => ({ task })))),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
