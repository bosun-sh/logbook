import { Effect, type Layer } from "effect"
import { currentTask } from "../task/current-task.js"
import type { TaskRepository } from "../task/ports.js"

export const toolCurrentTask = (
  sessionId: string,
  layer: Layer.Layer<TaskRepository>
): Promise<{ task: unknown }> => {
  return Effect.runPromise(
    Effect.provide(
      currentTask(sessionId).pipe(Effect.map((task) => ({ task }))),
      layer
    ) as Effect.Effect<{ task: unknown }, never>
  )
}
