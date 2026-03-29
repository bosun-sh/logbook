import { Effect } from "effect"
import type { TaskError } from "./types.js"

export interface KTokensConfig {
  anchorPoint: number      // Fibonacci number to anchor against
  kTokensAtAnchor: number  // how many kTokens map to anchorPoint
  maxKTokens: number       // cap (inclusive)
}

export const defaultConfig: KTokensConfig = {
  anchorPoint: 8,
  kTokensAtAnchor: 20,
  maxKTokens: 20,
}

// Fibonacci sequence for lookup
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]

export const estimateFromKTokens = (
  kTokens: number,
  config: KTokensConfig = defaultConfig,
): Effect.Effect<number, TaskError> => {
  // Fail if kTokens <= 0
  if (kTokens <= 0) {
    return Effect.fail({
      _tag: 'validation_error',
      message: 'predicted kilotokens must be positive',
    })
  }

  // Fail if kTokens > config.maxKTokens
  if (kTokens > config.maxKTokens) {
    return Effect.fail({
      _tag: 'validation_error',
      message: 'predicted kilotokens exceed maximum allowed',
    })
  }

  // Calculate ratio: kTokensAtAnchor / anchorPoint
  const ratio = config.kTokensAtAnchor / config.anchorPoint

  // Scale kTokens to estimate space
  const scaled = kTokens / ratio

  // Find nearest Fibonacci number, rounding UP on tie
  let nearestFib: number = FIBONACCI[0] ?? 1
  let minDistance = Math.abs(nearestFib - scaled)

  for (const fib of FIBONACCI) {
    const distance = Math.abs(fib - scaled)

    // On exact match, return immediately
    if (distance === 0) {
      return Effect.succeed(fib)
    }

    // On tie, pick the larger value (UP)
    if (distance < minDistance || (distance === minDistance && fib > nearestFib)) {
      nearestFib = fib
      minDistance = distance
    }
  }

  return Effect.succeed(nearestFib)
}
