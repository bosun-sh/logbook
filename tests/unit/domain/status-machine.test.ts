import { describe, expect, test } from "bun:test"
import { guardTransition } from "@logbook/domain/status-machine.js"
import type { Status } from "@logbook/domain/types.js"
import { Effect } from "effect"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(
    effect.pipe(
      Effect.matchEffect({
        onFailure: (e) => Effect.succeed(e),
        onSuccess: () => Effect.die(new Error("Expected failure but got success")),
      })
    )
  )

describe("status-machine / valid transitions", () => {
  const valid: Array<[Status, Status]> = [
    ["backlog", "todo"],
    ["todo", "backlog"],
    ["todo", "in_progress"],
    ["in_progress", "todo"],
    ["in_progress", "pending_review"],
    ["in_progress", "need_info"],
    ["in_progress", "blocked"],
    ["blocked", "in_progress"],
    ["need_info", "in_progress"],
    ["pending_review", "done"],
    ["pending_review", "in_progress"],
  ]

  for (const [from, to] of valid) {
    test(`${from} → ${to}`, async () => {
      await run(guardTransition(from, to))
    })
  }
})

describe("status-machine / invalid transitions", () => {
  const invalid: Array<[Status, Status]> = [
    ["backlog", "pending_review"],
    ["backlog", "done"],
    ["backlog", "in_progress"],
    ["todo", "done"],
    ["need_info", "done"],
    ["done", "in_progress"],
  ]

  for (const [from, to] of invalid) {
    test(`${from} → ${to} fails with transition_not_allowed`, async () => {
      const err = await runFail(guardTransition(from, to))
      expect(err).toMatchObject({ _tag: "transition_not_allowed", from, to })
    })
  }
})

describe("status-machine / no-op transitions", () => {
  const statuses: Status[] = [
    "backlog",
    "todo",
    "need_info",
    "blocked",
    "in_progress",
    "pending_review",
    "done",
  ]

  for (const s of statuses) {
    test(`${s} → ${s} is a no-op success`, async () => {
      await run(guardTransition(s, s))
    })
  }
})

describe("status-machine / review task exception", () => {
  test("in_progress → done succeeds for review task", async () => {
    await run(guardTransition("in_progress", "done", "review-abc123"))
  })

  test("in_progress → done fails for non-review task", async () => {
    const err = await runFail(guardTransition("in_progress", "done", "abc123"))
    expect(err).toMatchObject({ _tag: "transition_not_allowed", from: "in_progress", to: "done" })
  })

  test("in_progress → done fails without taskId", async () => {
    const err = await runFail(guardTransition("in_progress", "done"))
    expect(err).toMatchObject({ _tag: "transition_not_allowed", from: "in_progress", to: "done" })
  })
})
