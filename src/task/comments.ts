import type { ToolResult } from "@logbook/shared/result.js"
import type { Comment, CommentReply } from "@logbook/shared/schema/value-objects.js"
import type { Task } from "./schema.js"

const MAX_COMMENT_CONTENT_BYTES = 65_536
const textEncoder = new TextEncoder()

export const appendTaskComment = (task: Task, comment: Comment): ToolResult<Task> => {
  const priorityError = validatePriority(task.priority)
  if (priorityError) {
    return priorityError
  }

  const commentError = validateCommentContent(comment.content)
  if (commentError) {
    return commentError
  }

  return {
    ok: true,
    data: {
      ...task,
      updatedAt: comment.createdAt,
      comments: [...task.comments, comment],
    },
  }
}

export const appendTaskReply = (
  task: Task,
  commentId: string,
  reply: CommentReply
): ToolResult<Task> => {
  const priorityError = validatePriority(task.priority)
  if (priorityError) {
    return priorityError
  }

  const replyError = validateCommentContent(reply.content)
  if (replyError) {
    return replyError
  }

  let found = false
  const comments = task.comments.map((comment) => {
    if (comment.id !== commentId) {
      return comment
    }

    found = true
    return {
      ...comment,
      replies: [...comment.replies, reply],
    }
  })

  if (!found) {
    return error("not_found", `comment ${commentId} was not found`, { commentId })
  }

  return {
    ok: true,
    data: {
      ...task,
      updatedAt: reply.createdAt,
      comments,
    },
  }
}

export const validatePriority = (priority: number): ToolResult<never> | null => {
  if (!Number.isInteger(priority) || priority < 0) {
    return error("validation_error", "priority must be an integer greater than or equal to 0", {
      priority,
    })
  }

  return null
}

export const validateCommentContent = (content: string): ToolResult<never> | null => {
  const bytes = textEncoder.encode(content).length
  if (bytes > MAX_COMMENT_CONTENT_BYTES) {
    return error("validation_error", `comment content exceeds ${MAX_COMMENT_CONTENT_BYTES} bytes`, {
      maxBytes: MAX_COMMENT_CONTENT_BYTES,
      actualBytes: bytes,
    })
  }

  return null
}

export const error = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  },
})
