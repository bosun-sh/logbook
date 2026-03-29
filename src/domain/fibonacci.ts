import { Effect } from "effect"
import type { TaskError } from "./types.js"

/**
 * Validates that n is a positive Fibonacci number.
 * Returns Effect.succeed(void) when valid,
 * Effect.fail({ _tag: 'validation_error', message: 'estimation must be a Fibonacci number' }) otherwise.
 *
 * Algorithm: n is Fibonacci iff one of 5n²+4 or 5n²-4 is a perfect square.
 */
export const validateFibonacci = (n: number): Effect.Effect<void, TaskError> => {
  // Must be a positive integer
  if (!Number.isInteger(n) || n <= 0) {
    return Effect.fail({
      _tag: "validation_error",
      message: "estimation must be a Fibonacci number",
    })
  }

  // Check if a number is a perfect square
  const isPerfectSquare = (num: number): boolean => {
    if (num < 0) return false
    const sqrt = Math.sqrt(num)
    return sqrt === Math.floor(sqrt)
  }

  // n is Fibonacci iff 5n²+4 or 5n²-4 is a perfect square
  const fiveSqPlusFour = 5 * n * n + 4
  const fiveSqMinusFour = 5 * n * n - 4

  if (isPerfectSquare(fiveSqPlusFour) || isPerfectSquare(fiveSqMinusFour)) {
    return Effect.succeed(void 0)
  }

  return Effect.fail({
    _tag: "validation_error",
    message: "estimation must be a Fibonacci number",
  })
}
