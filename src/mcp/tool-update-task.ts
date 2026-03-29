import { Effect, type Layer } from "effect"
import { z } from "zod"
import { CommentKindSchema, StatusSchema } from "../domain/types.js"
import type { HookRunner } from "../hook/ports.js"
import type { TaskRepository } from "../task/ports.js"
import { updateTask } from "../task/update-task.js"

const CommentInputSchema = z
  .object({
    title: z.string().min(1),
    content: z.string(),
    kind: CommentKindSchema,
  })
  .optional()

const InputSchema = z.object({
  id: z.string().min(1),
  new_status: StatusSchema,
  comment: CommentInputSchema,
})

export const toolUpdateTask = (
  rawInput: unknown,
  sessionId: string,
  layer: Layer.Layer<TaskRepository | HookRunner>
): Promise<{ ok: boolean }> => {
  const input = InputSchema.parse(rawInput)
  const comment = input.comment
    ? {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        title: input.comment.title,
        content: input.comment.content,
        reply: "",
        kind: input.comment.kind,
      }
    : null

  return Effect.runPromise(
    Effect.provide(
      updateTask(input.id, input.new_status, comment, sessionId).pipe(
        Effect.map(() => ({ ok: true }))
      ),
      layer
    ) as Effect.Effect<{ ok: boolean }, never>
  )
}
