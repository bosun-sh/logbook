import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicWriteJsonl, withCanonicalWriteLock } from "@logbook/shared/storage/atomic-write.js"
import { Effect } from "effect"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const runFail = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: () => {
          throw new Error("Expected effect to fail")
        },
        onFailure: (error) => error,
      })
    ) as Effect.Effect<E, never>
  )

describe("atomicWriteJsonl", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("rewrites through temp-file and rename after validating non-empty lines", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-05-atomic-"))
    const filePath = join(workspaceRoot, "tasks.jsonl")
    await writeFile(filePath, '{"id":"old"}\n', "utf8")

    await run(
      atomicWriteJsonl({
        filePath,
        lines: ['{"id":"new"}'],
        validateLine: (parsed) => {
          expect(parsed).toEqual({ id: "new" })
        },
      })
    )

    await expect(readFile(filePath, "utf8")).resolves.toBe('{"id":"new"}\n')
  })

  test("keeps original file unchanged when validation fails before rename", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-05-validation-"))
    const filePath = join(workspaceRoot, "tasks.jsonl")
    await writeFile(filePath, '{"id":"original"}\n', "utf8")

    let renameCalls = 0
    const error = await runFail(
      atomicWriteJsonl({
        filePath,
        lines: ['{"id":"new"}'],
        validateLine: () => {
          throw new Error("schema-invalid")
        },
        io: {
          rename: async () => {
            renameCalls += 1
          },
        },
      })
    )

    expect(error).toMatchObject({ _tag: "storage_error", operation: "write", filePath })
    expect(renameCalls).toBe(0)
    await expect(readFile(filePath, "utf8")).resolves.toBe('{"id":"original"}\n')
  })

  test("fails after 10 temp suffix attempts and preserves original file", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-05-attempts-"))
    const filePath = join(workspaceRoot, "tasks.jsonl")
    await writeFile(filePath, '{"id":"original"}\n', "utf8")

    let renameCalls = 0
    const error = await runFail(
      atomicWriteJsonl({
        filePath,
        lines: ['{"id":"new"}'],
        validateLine: () => {},
        io: {
          rename: async () => {
            renameCalls += 1
            throw new Error("rename-failed")
          },
        },
      })
    )

    expect(renameCalls).toBe(10)
    expect(error).toMatchObject({
      _tag: "storage_error",
      operation: "write",
      filePath,
      message: expect.stringContaining("temp suffix attempts exhausted"),
    })
    await expect(readFile(filePath, "utf8")).resolves.toBe('{"id":"original"}\n')
  })
})

describe("withCanonicalWriteLock", () => {
  test("serializes writes for the same canonical file path", async () => {
    const order: string[] = []
    const filePath = "/tmp/logbook-lock-test.jsonl"

    const writeA = withCanonicalWriteLock(
      filePath,
      Effect.gen(function* () {
        order.push("a-start")
        yield* Effect.sleep("20 millis")
        order.push("a-end")
      })
    )

    const writeB = withCanonicalWriteLock(
      filePath,
      Effect.sync(() => {
        order.push("b-start")
        order.push("b-end")
      })
    )

    await run(Effect.all([writeA, writeB], { concurrency: "unbounded" }))
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"])
  })
})
