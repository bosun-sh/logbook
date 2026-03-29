import { Effect } from "effect"
import type { Status, TaskError } from "./types.js"

/**
 * Guards a status transition, returning Effect.succeed(void) when allowed
 * and Effect.fail({ _tag: 'transition_not_allowed', from, to }) otherwise.
 * A same→same transition is always a no-op success.
 */
export const guardTransition = (
  from: Status,
  to: Status,
): Effect.Effect<void, TaskError> =>
  Effect.die(new Error("not implemented"))
