import { Effect, Layer } from "effect"
import { TaskRepository } from "../task/ports.js"
import { currentTask } from "../task/current-task.js"

export const toolCurrentTask = (
  sessionId: string,
  layer: Layer.Layer<TaskRepository>,
): Promise<{ task: unknown }> => {
  return Effect.runPromise(
    Effect.provide(
      currentTask(sessionId).pipe(
        Effect.map(task => ({ task }))
      ),
      layer,
    ) as Effect.Effect<{ task: unknown }, never>
  )
}
