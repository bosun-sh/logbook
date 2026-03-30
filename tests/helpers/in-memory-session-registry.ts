import type { SessionRegistry } from "@logbook/task/session-registry.js"
import { Effect } from "effect"

/**
 * Test double for SessionRegistry. Caller sets liveness explicitly via `setAlive`.
 * Sessions not explicitly configured default to dead (false).
 */
export class InMemorySessionRegistry implements SessionRegistry {
  private readonly liveness = new Map<string, boolean>()

  setAlive(sessionId: string, alive: boolean): void {
    this.liveness.set(sessionId, alive)
  }

  isAlive(sessionId: string): Effect.Effect<boolean, never> {
    return Effect.succeed(this.liveness.get(sessionId) ?? false)
  }

  register(_sessionId: string, _pid: number): Effect.Effect<void, never> {
    return Effect.succeed(undefined)
  }

  deregister(_sessionId: string): Effect.Effect<void, never> {
    return Effect.succeed(undefined)
  }
}
