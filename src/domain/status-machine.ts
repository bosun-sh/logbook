import { Effect } from "effect"
import type { Status, TaskError } from "./types.js"

// Allowed state transitions: from → [to, to, ...]
export const allowedTransitions: Record<Status, Status[]> = {
  backlog: ["todo"],
  todo: ["backlog", "in_progress"],
  in_progress: ["todo", "pending_review", "need_info", "blocked"],
  blocked: ["in_progress"],
  need_info: ["in_progress"],
  pending_review: ["done", "in_progress"],
  done: [],
}

/**
 * Guards a status transition, returning Effect.succeed(void) when allowed
 * and Effect.fail({ _tag: 'transition_not_allowed', from, to }) otherwise.
 * A same→same transition is always a no-op success.
 * Review tasks (id starts with "review-") may go directly from in_progress to done.
 */
export const guardTransition = (
  from: Status,
  to: Status,
  taskId?: string
): Effect.Effect<void, TaskError> => {
  // Same→same is always a no-op success
  if (from === to) {
    return Effect.void
  }

  // Check if transition is in the allowed map
  const allowed = allowedTransitions[from]
  if (allowed.includes(to)) {
    return Effect.void
  }

  // Review tasks may skip pending_review and go directly to done
  if (from === "in_progress" && to === "done" && taskId?.startsWith("review-")) {
    return Effect.void
  }

  // Transition not allowed
  return Effect.fail({
    _tag: "transition_not_allowed",
    from,
    to,
    taskId,
  } as TaskError)
}
