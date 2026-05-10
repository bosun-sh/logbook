import { describe, expect, test } from "bun:test"
import { createId, parseId } from "@logbook/shared/ids.js"
import { nowIso } from "@logbook/shared/time.js"
import { Clock, Effect } from "effect"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-01T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-01T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

describe("shared primitives", () => {
  test("createId prefixes the kind and parseId validates the prefix", () => {
    const id = createId("task")

    expect(id.startsWith("task_")).toBe(true)
    expect(parseId("task", id)).toBe(id)
    expect(parseId("story", id)).toBeNull()
  })

  test("parseId rejects malformed ids", () => {
    expect(parseId("task", "")).toBeNull()
    expect(parseId("task", "task_")).toBeNull()
    expect(parseId("task", "task-123")).toBeNull()
    expect(parseId("task", "story_123")).toBeNull()
  })

  test("nowIso reads the Clock service with UTC millisecond precision", async () => {
    const iso = await run(Effect.withClock(fixedClock)(nowIso()))

    expect(iso).toBe("2026-01-01T12:34:56.789Z")
  })
})
