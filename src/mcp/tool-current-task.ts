import { Effect, Either, type Layer } from "effect"
import { currentTask } from "../task/current-task.js"
import type { TaskRepository } from "../task/ports.js"

export const toolCurrentTask = (
  sessionId: string,
  layer: Layer.Layer<TaskRepository>
): Promise<{ task: unknown }> => {
  return Effect.runPromise(
    Effect.provide(
      Effect.either(currentTask(sessionId).pipe(Effect.map((task) => ({ task })))),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
