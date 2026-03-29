import { Effect } from "effect"
import type { Status, TaskError } from "./types.js"

// Allowed state transitions: from → [to, to, ...]
const allowedTransitions: Record<Status, Status[]> = {
  backlog: ['todo'],
  todo: ['backlog', 'in_progress'],
  in_progress: ['todo', 'pending_review', 'need_info', 'blocked'],
  blocked: ['in_progress'],
  need_info: ['in_progress'],
  pending_review: ['done', 'in_progress'],
  done: [],
}

/**
 * Guards a status transition, returning Effect.succeed(void) when allowed
 * and Effect.fail({ _tag: 'transition_not_allowed', from, to }) otherwise.
 * A same→same transition is always a no-op success.
 */
export const guardTransition = (
  from: Status,
  to: Status,
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

  // Transition not allowed
  return Effect.fail({
    _tag: 'transition_not_allowed',
    from,
    to,
  } as TaskError)
}
