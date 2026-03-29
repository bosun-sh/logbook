import { describe, expect, test } from "bun:test"
import { estimateFromKTokens } from "@logbook/domain/kTokens.js"
import { Effect } from "effect"

const run = <A>(e: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(e as Effect.Effect<A, never>)

const runFail = <A>(e: Effect.Effect<A, unknown>): Promise<{ _tag: string }> =>
  Effect.runPromise(
    e.pipe(
      Effect.matchEffect({
        onFailure: (err) => Effect.succeed(err as { _tag: string }),
        onSuccess: () => Effect.die(new Error("Expected failure")),
      })
    ) as Effect.Effect<{ _tag: string }, never>
  )

describe("estimateFromKTokens", () => {
  test("kTokens=20 (at anchor) → 8", async () => {
    const r = await run(estimateFromKTokens(20))
    expect(r).toBe(8)
  })

  test("kTokens=5 → 2 (5/2.5=2.0, nearest fib=2)", async () => {
    const r = await run(estimateFromKTokens(5))
    expect(r).toBe(2)
  })

  test("kTokens=10 → 5 (10/2.5=4.0, tie between 3 and 5, pick UP=5)", async () => {
    const r = await run(estimateFromKTokens(10))
    expect(r).toBe(5)
  })

  test("kTokens=0 → validation_error", async () => {
    const err = await runFail(estimateFromKTokens(0))
    expect(err._tag).toBe("validation_error")
  })

  test("kTokens=-1 → validation_error", async () => {
    const err = await runFail(estimateFromKTokens(-1))
    expect(err._tag).toBe("validation_error")
  })

  test("kTokens=21 (above maxKTokens=20) → validation_error", async () => {
    const err = await runFail(estimateFromKTokens(21))
    expect(err._tag).toBe("validation_error")
  })

  test("kTokens=20 with custom config anchorPoint=5, kTokensAtAnchor=10 → 5", async () => {
    const r = await run(
      estimateFromKTokens(10, { anchorPoint: 5, kTokensAtAnchor: 10, maxKTokens: 100 })
    )
    expect(r).toBe(5)
  })
})
