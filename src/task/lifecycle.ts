import type { ToolResult } from "@logbook/shared/result.js"
import type { Comment } from "@logbook/shared/schema/value-objects.js"
import { appendTaskComment, error, validateCommentContent, validatePriority } from "./comments.js"
import type { Task } from "./schema.js"

type TaskStatus = Task["status"]
type TransitionComment = Omit<Comment, "kind"> & { readonly kind?: Comment["kind"] }

type TransitionOptions = {
  readonly now: string
  readonly comment?: TransitionComment | undefined
}

const allowedTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["todo", "canceled"],
  todo: ["in_progress", "canceled"],
  in_progress: ["need_info", "blocked", "pending_review", "canceled"],
  need_info: ["in_progress", "canceled"],
  blocked: ["in_progress", "canceled"],
  pending_review: ["in_progress", "done", "canceled"],
  done: [],
  canceled: [],
}

export const transitionTaskStatus = (
  task: Task,
  nextStatus: TaskStatus,
  options: TransitionOptions
): ToolResult<Task> => {
  const priorityError = validatePriority(task.priority)
  if (priorityError) {
    return priorityError
  }

  if (task.status === nextStatus) {
    return { ok: true, data: task }
  }

  if (!allowedTransitions[task.status].includes(nextStatus)) {
    return error(
      "invalid_transition",
      `cannot transition task from ${task.status} to ${nextStatus}`,
      {
        from: task.status,
        to: nextStatus,
      }
    )
  }

  const comment = normalizeTransitionComment(nextStatus, options.comment)
  const commentError = validateTransitionComment(nextStatus, comment)
  if (commentError) {
    return commentError
  }

  const nextTask: Task = {
    ...task,
    status: nextStatus,
    updatedAt: options.now,
    ...(nextStatus === "in_progress" ? { inProgressSince: options.now } : {}),
  }

  const withoutStaleProgress =
    task.status === "in_progress" && nextStatus !== "in_progress"
      ? clearInProgressSince(nextTask)
      : nextTask

  if (!comment) {
    return { ok: true, data: withoutStaleProgress }
  }

  return appendTaskComment(withoutStaleProgress, comment)
}

const normalizeTransitionComment = (
  nextStatus: TaskStatus,
  comment: TransitionComment | undefined
): Comment | undefined => {
  if (!comment) {
    return undefined
  }

  if (comment.kind !== undefined) {
    return comment as Comment
  }

  if (nextStatus === "pending_review" || nextStatus === "done") {
    return { ...comment, kind: "review" }
  }

  return { ...comment, kind: "regular" }
}

const validateTransitionComment = (
  nextStatus: TaskStatus,
  comment: Comment | undefined
): ToolResult<never> | null => {
  if (comment) {
    const contentError = validateCommentContent(comment.content)
    if (contentError) {
      return contentError
    }
  }

  if (nextStatus === "need_info") {
    if (!comment || comment.kind !== "need_info") {
      return error("validation_error", "need_info transitions require a need_info comment")
    }
  }

  if (nextStatus === "blocked") {
    if (!comment || (comment.kind !== "regular" && comment.kind !== "need_info")) {
      return error("validation_error", "blocked transitions require a regular or need_info comment")
    }
  }

  return null
}

const clearInProgressSince = (task: Task): Task => {
  const { inProgressSince: _inProgressSince, ...rest } = task
  return rest
}
