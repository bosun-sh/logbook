import { Effect, Layer } from "effect"
import { z } from "zod"
import { TaskRepository } from "../task/ports.js"
import { createTask } from "../task/create-task.js"

const InputSchema = z.object({
  project:            z.string().min(1),
  milestone:          z.string().min(1),
  title:              z.string().min(1),
  definition_of_done: z.string().min(1),
  description:        z.string().min(1),
  predictedKTokens:   z.number().positive(),
})

export const toolCreateTask = (
  rawInput: unknown,
  sessionId: string,
  layer: Layer.Layer<TaskRepository>,
): Promise<{ task: unknown }> => {
  const input = InputSchema.parse(rawInput)
  return Effect.runPromise(
    Effect.provide(
      createTask(input, sessionId).pipe(
        Effect.map(task => ({ task }))
      ),
      layer,
    ) as Effect.Effect<{ task: unknown }, never>
  )
}
