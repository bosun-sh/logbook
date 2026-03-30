import { Effect, Either, type Layer } from "effect"
import { currentTask } from "../task/current-task.js"
import type { TaskRepository } from "../task/ports.js"
import type { SessionRegistry } from "../task/session-registry.js"

export const toolCurrentTask = (
  sessionId: string,
  layer: Layer.Layer<TaskRepository | SessionRegistry>
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
