import { describe, expect, test } from "bun:test"
import { validateFibonacci } from "@logbook/domain/fibonacci.js"
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

describe("fibonacci / valid values", () => {
  const valid = [1, 2, 3, 5, 8, 13, 21, 34, 55]

  for (const n of valid) {
    test(`${n} is valid`, async () => {
      await run(validateFibonacci(n))
    })
  }
})

describe("fibonacci / invalid values", () => {
  const invalid = [4, 6, 0, -1, 1.5]

  for (const n of invalid) {
    test(`${n} fails with validation_error`, async () => {
      const err = await runFail(validateFibonacci(n))
      expect(err).toMatchObject({
        _tag: "validation_error",
        message: "estimation must be a Fibonacci number",
      })
    })
  }
})
