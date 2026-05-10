import { Clock, Effect } from "effect"

export const nowIso = (): Effect.Effect<string, never, Clock.Clock> =>
  Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())
