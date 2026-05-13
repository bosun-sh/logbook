import { Context, type Effect } from "effect"

export interface SessionLivenessPort {
  isAlive(sessionId: string): Effect.Effect<boolean, never>
}

export const SessionLivenessPort = Context.GenericTag<SessionLivenessPort>("SessionLivenessPort")
