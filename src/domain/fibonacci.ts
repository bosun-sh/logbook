import { Effect } from "effect"
import type { TaskError } from "./types.js"

/**
 * Validates that n is a positive Fibonacci number.
 * Returns Effect.succeed(void) when valid,
 * Effect.fail({ _tag: 'validation_error', message: 'estimation must be a Fibonacci number' }) otherwise.
 */
export const validateFibonacci = (n: number): Effect.Effect<void, TaskError> =>
  Effect.die(new Error("not implemented"))
