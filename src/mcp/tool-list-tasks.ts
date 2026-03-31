import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import { StatusSchema } from "../domain/types.js"
import { listTasks } from "../task/list-tasks.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  status: z.union([StatusSchema, z.literal("*")]).default("in_progress"),
  project: z.string().optional(),
  milestone: z.string().optional(),
})

export const toolListTasks = (
  rawInput: unknown,
  layer: Layer.Layer<TaskRepository>
): Promise<{ tasks: unknown[] }> => {
  const input = InputSchema.parse(rawInput)
  const options = {
    status: input.status,
    ...(input.project !== undefined ? { project: input.project } : {}),
    ...(input.milestone !== undefined ? { milestone: input.milestone } : {}),
  }
  return Effect.runPromise(
    Effect.provide(
      Effect.either(
        listTasks(options).pipe(Effect.map((tasks) => ({ tasks: tasks as unknown[] })))
      ),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
