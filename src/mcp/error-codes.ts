import { allowedTransitions } from "../domain/status-machine.js"
import type { Status, TaskError } from "../domain/types.js"

export interface McpError {
  code: number
  message: string
  data: Record<string, unknown>
}

const NORMAL_FLOW = "backlog → todo → in_progress → pending_review → done"

/**
 * Builds a declarative error message for transition_not_allowed errors.
 * Includes allowed transitions, review task hint, and corrective guidance.
 */
const buildTransitionErrorMessage = (
  from: Status,
  to: Status,
  taskId?: string
): { message: string; data: Record<string, unknown> } => {
  const isReviewTask = taskId?.startsWith("review-") ?? false
  const allowed = allowedTransitions[from]

  let message = `Status transition not allowed: cannot move from '${from}' to '${to}'.\n\n`
  message += `Normal flow:\n  ${NORMAL_FLOW}\n\n`
  message += `Allowed transitions from '${from}': ${allowed.join(", ") || "none"}\n\n`

  message += "Special cases:\n"
  message +=
    "  - Review tasks (id starting with 'review-') can skip pending_review: in_progress → done\n"
  message += "  - blocked tasks return to in_progress\n"
  message += "  - need_info tasks return to in_progress\n"
  message += "  - Tasks in pending_review can return to in_progress or proceed to done\n\n"

  if (allowed.length === 0) {
    message += "This status is terminal. No further transitions are possible."
  } else {
    message += `To proceed: transition to one of [${allowed.join(", ")}] first.`
  }

  const hint =
    allowed.length === 0
      ? "No further transitions possible from done."
      : `Try transitioning to ${allowed[0]} first.`

  return {
    message,
    data: {
      from,
      to,
      taskId,
      allowedFrom: Object.keys(allowedTransitions).filter((s) =>
        allowedTransitions[s as Status].includes(from)
      ),
      allowedTo: allowed,
      normalFlow: NORMAL_FLOW,
      isReviewTask,
      hint,
    },
  }
}

/**
 * Builds a declarative error message for missing_comment errors.
 */
const buildMissingCommentMessage = (
  from?: Status,
  to?: Status
): { message: string; data: Record<string, unknown> } => {
  let message = "A comment is required for this transition.\n\n"

  if (from && to) {
    message += `Transition: ${from} → ${to} requires a comment.\n`
    if (to === "need_info") {
      message +=
        "Reason: need_info status requires documentation of what information is needed.\n\n"
    } else if (to === "blocked") {
      message += "Reason: blocked status requires documentation of why the task is blocked.\n\n"
    }
  }

  message += "Include a comment with non-empty content to proceed."

  return {
    message,
    data: { from, to },
  }
}

/**
 * Builds a declarative error message for validation_error messages.
 * Matches known raw messages and enhances them with context.
 */
const buildValidationErrorMessage = (
  rawMessage: string,
  context?: Record<string, unknown>
): { message: string; data: Record<string, unknown> } => {
  // Concurrent in_progress guard
  if (rawMessage === "moving a second task to in_progress requires a justification comment") {
    const inProgressTasks = (context?.inProgressTasks as Array<{ id: string; title: string }>) ?? []
    let message =
      "Cannot move this task to in_progress: another task is already in_progress for this session.\n\n"

    if (inProgressTasks.length > 0) {
      message += "Current in_progress tasks for this session:\n"
      for (const t of inProgressTasks) {
        message += `  - ${t.title} (id: ${t.id})\n`
      }
      message += "\n"
    }

    message +=
      "When moving a second task to in_progress, you must provide a justification comment\n"
    message += "explaining why this task takes priority over the existing one.\n\n"
    message += "Include a non-empty comment explaining the priority change."

    return {
      message,
      data: { message: rawMessage, ...context },
    }
  }

  // Reply on regular comment
  if (rawMessage === "reply is only valid on need_info comments") {
    const commentId = context?.commentId as string | undefined
    const commentKind = context?.commentKind as string | undefined

    let message = "Cannot reply to this comment.\n\n"
    if (commentId) {
      message += `Comment id: ${commentId}\n`
    }
    if (commentKind) {
      message += `Comment kind: ${commentKind}\n`
    }
    message +=
      "\nReplies are only allowed on 'need_info' comments. Regular comments cannot receive replies.\n\n"
    message +=
      "To proceed: either remove the reply field, or change the comment kind to 'need_info'."

    return {
      message,
      data: { message: rawMessage, ...context },
    }
  }

  // Blocking comment without reply
  if (rawMessage.startsWith("blocking comment ") && rawMessage.endsWith(" has no reply")) {
    const commentId = context?.commentId as string | undefined
    const commentTitle = context?.commentTitle as string | undefined
    const commentContent = context?.commentContent as string | undefined
    const commentTimestamp = context?.commentTimestamp as Date | undefined

    let message =
      "Cannot transition from need_info to in_progress: blocking comment has no reply.\n\n"
    message += "Blocking comment:\n"
    if (commentId) message += `  - id: ${commentId}\n`
    if (commentTitle) message += `  - title: ${commentTitle}\n`
    if (commentContent) {
      const truncated =
        commentContent.length > 50 ? commentContent.slice(0, 50) + "..." : commentContent
      message += `  - content: ${truncated}\n`
    }
    if (commentTimestamp) message += `  - created: ${commentTimestamp.toISOString()}\n`
    message += "\nYou must reply to this need_info comment before transitioning to in_progress.\n\n"
    message += "Include a reply in your comment to proceed."

    return {
      message,
      data: { message: rawMessage, ...context },
    }
  }

  // Empty blocked content
  if (rawMessage === "blocked requires a non-empty comment") {
    let message = "Cannot transition to blocked with an empty comment.\n\n"
    message += "When blocking a task, you must provide a reason in the comment content.\n\n"
    message += "Include a non-empty comment explaining why the task is blocked."

    return {
      message,
      data: { message: rawMessage, ...context },
    }
  }

  // Fallback: pass through unknown validation errors
  return {
    message: rawMessage,
    data: { message: rawMessage, ...context },
  }
}

export const taskErrorToMcpError = (err: TaskError): McpError => {
  switch (err._tag) {
    case "not_found":
      return { code: -32001, message: "Task not found", data: { taskId: err.taskId } }
    case "transition_not_allowed": {
      const { message, data } = buildTransitionErrorMessage(err.from, err.to, err.taskId)
      return { code: -32002, message, data }
    }
    case "validation_error": {
      const { message, data } = buildValidationErrorMessage(err.message, err.context)
      return { code: -32003, message, data }
    }
    case "missing_comment": {
      const { message, data } = buildMissingCommentMessage(err.from, err.to)
      return { code: -32004, message, data }
    }
    case "conflict":
      return { code: -32005, message: "Task already exists", data: { taskId: err.taskId } }
    case "no_current_task":
      return { code: -32006, message: "No current task for this session", data: {} }
  }
}
