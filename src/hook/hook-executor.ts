import { Effect } from "effect"
import type { HookEvent } from "./ports.js"

export interface HookConfig {
  event:      string
  condition?: string
  timeout_ms?: number
  script:     string
}

/**
 * Executes all hooks whose event matches and whose condition (if any) evaluates to true.
 * Hooks exceeding timeout_ms are terminated; executeHooks always returns Effect.succeed.
 * Scripts receive the HookEvent as context.
 */
export const executeHooks = (
  event: HookEvent,
  configs: readonly HookConfig[],
): Effect.Effect<void, never> =>
  Effect.die(new Error("not implemented"))
