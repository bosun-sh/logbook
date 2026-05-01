import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import { createTask } from "../task/create-task.js"
import type { TaskRepository } from "../task/ports.js"

const InputSchema = z.object({
  project: z.string().min(1),
  milestone: z.string().min(1),
  title: z.string().min(1),
  definition_of_done: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  test_cases: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .default([]),
  description: z.string().min(1),
  predictedKTokens: z.number().positive(),
  priority: z.number().int().min(0).default(0),
})

const normalizeStringArray = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

export const toolCreateTask = (
  rawInput: unknown,
  _sessionId: string,
  layer: Layer.Layer<TaskRepository>
): Promise<{ task: unknown }> => {
  const parsed = InputSchema.parse(rawInput)
  const input = {
    ...parsed,
    definition_of_done: normalizeStringArray(parsed.definition_of_done),
    test_cases: normalizeStringArray(parsed.test_cases),
  }
  return Effect.runPromise(
    Effect.provide(
      Effect.either(createTask(input, _sessionId).pipe(Effect.map((task) => ({ task })))),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
