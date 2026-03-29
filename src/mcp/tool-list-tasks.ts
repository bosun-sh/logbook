import { Effect, type Layer } from "effect"
import { z } from "zod"
import { StatusSchema } from "../domain/types.js"
import { listTasks } from "../task/list-tasks.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  status: z.union([StatusSchema, z.literal("*")]).default("in_progress"),
})

export const toolListTasks = (
  rawInput: unknown,
  layer: Layer.Layer<TaskRepository>
): Promise<{ tasks: unknown[] }> => {
  const input = InputSchema.parse(rawInput)
  return Effect.runPromise(
    Effect.provide(
      listTasks(input.status).pipe(Effect.map((tasks) => ({ tasks: tasks as unknown[] }))),
      layer
    ) as Effect.Effect<{ tasks: unknown[] }, never>
  )
}
