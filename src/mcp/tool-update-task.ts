import { Effect, Either, type Layer } from "effect"
import { z } from "zod"
import { CommentKindSchema, StatusSchema } from "../domain/types.js"
import type { HookRunner } from "../hook/ports.js"
import type { TaskRepository } from "../task/ports.js"
import { updateTask } from "../task/update-task.js"

const CommentInputSchema = z
  .object({
    id: z.string().uuid().optional(), // provided only when replying to an existing comment
    title: z.string().min(1),
    content: z.string(),
    reply: z.string().optional(), // reply text; only meaningful when id is provided
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
        id: input.comment.id ?? crypto.randomUUID(),
        timestamp: new Date(),
        title: input.comment.title,
        content: input.comment.content,
        reply: input.comment.reply ?? "",
        kind: input.comment.kind,
      }
    : null

  return Effect.runPromise(
    Effect.provide(
      Effect.either(
        updateTask(input.id, input.new_status, comment, sessionId).pipe(
          Effect.map(() => ({ ok: true }))
        )
      ),
      layer
    )
  ).then((either) => {
    if (Either.isLeft(either)) throw either.left
    return either.right
  })
}
