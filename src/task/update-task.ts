import { Effect } from "effect"
import { guardTransition } from "../domain/status-machine.js"
import type { Comment, Status, TaskError } from "../domain/types.js"
import { HookRunner } from "../hook/ports.js"
import { TaskRepository } from "./ports.js"

/**
 * Transitions a task to a new status, optionally attaching or replying to a comment.
 * Enforces transition rules, comment requirements, need_info reply cycle,
 * and concurrent in_progress justification.
 * Fires HookRunner after a successful status change.
 */
export const updateTask = (
  id: string,
  newStatus: Status,
  comment: Comment | null,
  sessionId: string
): Effect.Effect<void, TaskError, TaskRepository | HookRunner> =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository
    const hookRunner = yield* HookRunner

    // Step 1: find task or fail with not_found
    const task = yield* repo.findById(id)

    // Step 2: guard transition (same→same is allowed by guardTransition too)
    // Pass task id so review tasks can skip pending_review and go directly to done
    yield* guardTransition(task.status, newStatus, task.id)

    // Step 4: reply handling — comment id matches an existing comment
    // Must run before the no-op check because a reply update is meaningful
    // even when the status is not changing.
    if (comment !== null) {
      const existing = task.comments.find((c) => c.id === comment.id)
      if (existing !== undefined) {
        if (existing.kind === "regular") {
          return yield* Effect.fail<TaskError>({
            _tag: "validation_error",
            message: "reply is only valid on need_info comments",
            context: { commentId: existing.id, commentKind: existing.kind },
          })
        }
        // existing.kind === 'need_info': merge reply and persist, no hook, no status change
        const updatedComments = task.comments.map((c) =>
          c.id === comment.id ? { ...c, reply: comment.reply } : c
        )
        const updatedTask = { ...task, comments: updatedComments }
        yield* repo.update(updatedTask)
        return
      }
    }

    // Step 3: no-op when status unchanged (and no reply was handled above)
    if (task.status === newStatus) return

    // Step 5: need_info requires a comment
    if (newStatus === "need_info" && comment === null) {
      return yield* Effect.fail<TaskError>({
        _tag: "missing_comment",
        from: task.status,
        to: newStatus,
      })
    }

    // Step 6: blocked requires a non-empty comment
    if (newStatus === "blocked") {
      if (comment === null) {
        return yield* Effect.fail<TaskError>({
          _tag: "missing_comment",
          from: task.status,
          to: newStatus,
        })
      }
      if (comment.content.trim() === "") {
        return yield* Effect.fail<TaskError>({
          _tag: "validation_error",
          message: "blocked requires a non-empty comment",
          context: { from: task.status, to: newStatus },
        })
      }
    }

    // Step 7: transitioning FROM need_info — all need_info comments must have a reply
    if (task.status === "need_info") {
      const blocking = task.comments.find((c) => c.kind === "need_info" && c.reply === "")
      if (blocking !== undefined) {
        return yield* Effect.fail<TaskError>({
          _tag: "validation_error",
          message: `blocking comment ${blocking.id} has no reply`,
          context: {
            commentId: blocking.id,
            commentTitle: blocking.title,
            commentContent: blocking.content,
            commentTimestamp: blocking.timestamp,
          },
        })
      }
    }

    // Step 8: concurrent in_progress — second task for same session requires justification
    if (newStatus === "in_progress") {
      const inProgressTasks = yield* repo.findByStatus("in_progress")
      const sessionInProgress = inProgressTasks.filter(
        (t) => t.assignee.id === sessionId && t.id !== task.id
      )
      if (sessionInProgress.length > 0) {
        if (comment === null || comment.content.trim() === "") {
          return yield* Effect.fail<TaskError>({
            _tag: "validation_error",
            message: "moving a second task to in_progress requires a justification comment",
            context: {
              inProgressTasks: sessionInProgress.map((t) => ({ id: t.id, title: t.title })),
            },
          })
        }
      }
    }

    // Step 9: apply changes
    const oldStatus = task.status
    const updatedComments = comment !== null ? [...task.comments, comment] : task.comments
    const updatedTask = {
      ...task,
      status: newStatus,
      comments: updatedComments,
      ...(newStatus === "in_progress" ? { in_progress_since: new Date() } : {}),
    }
    yield* repo.update(updatedTask)
    yield* hookRunner.run({
      task_id: id,
      old_status: oldStatus,
      new_status: newStatus,
      comment,
      session_id: sessionId,
    })
  })
