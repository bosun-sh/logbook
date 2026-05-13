import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import type { Comment, CommentReply } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { appendTaskReply, error, validateCommentContent } from "./comments.js"
import { transitionTaskStatus } from "./lifecycle.js"
import { TaskRepository } from "./ports.js"
import type { Task } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

export type TaskUpdateCommentInput = {
  readonly title?: string | undefined
  readonly content: string
  readonly kind?: Comment["kind"] | undefined
  readonly authorId?: string | undefined
  readonly replyToCommentId?: string | undefined
}

export type UpdateTaskStatusInput = {
  readonly id: string
  readonly newStatus: Task["status"]
  readonly comment?: TaskUpdateCommentInput | undefined
}

type UpdateTaskStatusResult = {
  readonly task: Task
}

export const updateTaskStatus = (
  input: UpdateTaskStatusInput
): Effect.Effect<ToolResult<UpdateTaskStatusResult>, never, TaskRepository | Clock.Clock> =>
  Effect.gen(function* () {
    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const now = yield* nowIso()
    const task = yield* Effect.either(repo.findById(input.id))
    if (task._tag === "Left") {
      return repositoryError(task.left)
    }

    if (input.comment?.replyToCommentId !== undefined) {
      const replyResult = appendReply(task.right, input.comment, now)
      if (!replyResult.ok) {
        return replyResult
      }

      const saved = yield* Effect.either(repo.update(replyResult.data))
      if (saved._tag === "Left") {
        return repositoryError(saved.left)
      }

      return {
        ok: true,
        data: {
          task: replyResult.data,
        },
      }
    }

    const transition = transitionTaskStatus(task.right, input.newStatus, {
      now,
      comment: input.comment === undefined ? undefined : toLifecycleComment(input.comment, now),
    })
    if (!transition.ok) {
      return transition
    }

    if (transition.data === task.right) {
      return {
        ok: true,
        data: {
          task: task.right,
        },
      }
    }

    const saved = yield* Effect.either(repo.update(transition.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        task: transition.data,
      },
    }
  })

const appendReply = (
  task: Task,
  comment: TaskUpdateCommentInput,
  now: string
): ToolResult<Task> => {
  const contentError = validateCommentContent(comment.content)
  if (contentError) {
    return contentError
  }

  const reply: CommentReply = {
    id: createId("reply"),
    content: comment.content,
    createdAt: now,
  }

  return appendTaskReply(task, comment.replyToCommentId ?? "", reply)
}

const toLifecycleComment = (
  comment: TaskUpdateCommentInput,
  now: string
): Omit<Comment, "kind"> & {
  readonly kind?: Comment["kind"]
} => ({
  id: createId("comment"),
  title: comment.title ?? `Status changed to ${comment.kind ?? "regular"}`,
  content: comment.content,
  createdAt: now,
  replies: [],
  ...(comment.kind === undefined ? {} : { kind: comment.kind }),
  ...(comment.authorId === undefined
    ? {}
    : {
        author: {
          id: comment.authorId,
          title: comment.authorId,
        },
      }),
})

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )
    return error(
      String(tagged._tag),
      typeof tagged.message === "string" ? tagged.message : "repository operation failed",
      Object.keys(details).length === 0 ? undefined : details
    )
  }

  return error("storage_error", "repository operation failed")
}
