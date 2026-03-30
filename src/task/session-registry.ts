import { Context, type Effect } from "effect"

export interface SessionRegistry {
  isAlive(sessionId: string): Effect.Effect<boolean, never>
  register(sessionId: string, pid: number): Effect.Effect<void, never>
  deregister(sessionId: string): Effect.Effect<void, never>
}

export const SessionRegistry = Context.GenericTag<SessionRegistry>("SessionRegistry")
