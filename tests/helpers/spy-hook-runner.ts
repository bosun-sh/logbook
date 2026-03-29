import type { HookEvent, HookRunner } from "@logbook/hook/ports.js"
import { Effect } from "effect"

export class SpyHookRunner implements HookRunner {
  calls: HookEvent[] = []

  run(event: HookEvent): Effect.Effect<void, never> {
    this.calls.push(event)
    return Effect.succeed(undefined)
  }

  reset(): void {
    this.calls = []
  }
}
