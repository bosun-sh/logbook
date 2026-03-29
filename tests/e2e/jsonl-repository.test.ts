import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JsonlTaskRepository } from "@logbook/infra/jsonl-task-repository.js"
import { Effect } from "effect"
import { makeTask } from "../helpers/factories.js"
import { createTempJsonl, type TempJsonl } from "../helpers/temp-jsonl.js"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const runFail = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<{ _tag: string; [k: string]: unknown }> =>
  Effect.runPromise(
    effect.pipe(
      Effect.matchEffect({
        onFailure: (e) => Effect.succeed(e as { _tag: string }),
        onSuccess: () => Effect.die(new Error("Expected failure")),
      })
    ) as Effect.Effect<{ _tag: string }, never>
  )

let tmp: TempJsonl

afterEach(async () => {
  await tmp?.cleanup()
})

describe("JsonlTaskRepository / e2e", () => {
  test("save() writes a task as a single JSONL line", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const task = makeTask()
    await run(repo.save(task))
    const lines = await tmp.read()
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0] ?? "")
    expect(parsed.id).toBe(task.id)
  })

  test("findById() reads back the saved task", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const task = makeTask()
    await run(repo.save(task))
    const found = await run(repo.findById(task.id))
    expect(found.id).toBe(task.id)
    expect(found.title).toBe(task.title)
  })

  test("findByStatus('backlog') returns only backlog tasks", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const t1 = makeTask({ status: "backlog" })
    const t2 = makeTask({ status: "todo" })
    await run(repo.save(t1))
    await run(repo.save(t2))
    const result = await run(repo.findByStatus("backlog"))
    expect(result.length).toBe(1)
    expect(result[0]?.id).toBe(t1.id)
  })

  test("findByStatus('*') returns all tasks", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const t1 = makeTask({ status: "backlog" })
    const t2 = makeTask({ status: "todo" })
    const t3 = makeTask({ status: "done" })
    await run(repo.save(t1))
    await run(repo.save(t2))
    await run(repo.save(t3))
    const result = await run(repo.findByStatus("*"))
    expect(result.length).toBe(3)
  })

  test("update() overwrites the correct line; other lines unchanged", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const t1 = makeTask({ status: "backlog" })
    const t2 = makeTask({ status: "todo" })
    await run(repo.save(t1))
    await run(repo.save(t2))
    const updated = {
      ...t1,
      title: "Updated Title",
      status: "in_progress" as const,
      in_progress_since: new Date(),
    }
    await run(repo.update(updated))
    const found = await run(repo.findById(t1.id))
    expect(found.title).toBe("Updated Title")
    expect(found.status).toBe("in_progress")
    // t2 unchanged
    const t2Found = await run(repo.findById(t2.id))
    expect(t2Found.status).toBe("todo")
  })

  test("findById() on missing id → not_found", async () => {
    tmp = await createTempJsonl()
    const repo = new JsonlTaskRepository(tmp.path)
    const err = await runFail(repo.findById("ghost-id"))
    expect(err._tag).toBe("not_found")
  })

  test("malformed JSON line → validation_error, does not panic", async () => {
    tmp = await createTempJsonl()
    await tmp.write(["{not valid json}"])
    const repo = new JsonlTaskRepository(tmp.path)
    const err = await runFail(repo.findByStatus("*") as Effect.Effect<unknown, unknown>)
    expect(err._tag).toBe("validation_error")
  })
})

describe("JsonlTaskRepository / missing file (ENOENT)", () => {
  let dir: string
  let missingPath: string

  const setup = async () => {
    dir = await mkdtemp(join(tmpdir(), "logbook-enoent-"))
    missingPath = join(dir, "tasks.jsonl")
  }
  const cleanup = () => rm(dir, { recursive: true, force: true })

  afterEach(cleanup)

  test("save() on missing file creates the file and persists the task", async () => {
    await setup()
    const repo = new JsonlTaskRepository(missingPath)
    const task = makeTask()
    await run(repo.save(task))
    const found = await run(repo.findById(task.id))
    expect(found.id).toBe(task.id)
  })

  test("update() on missing file → not_found", async () => {
    await setup()
    const repo = new JsonlTaskRepository(missingPath)
    const task = makeTask()
    const err = await runFail(repo.update(task))
    expect(err._tag).toBe("not_found")
  })

  test("findById() on missing file → not_found", async () => {
    await setup()
    const repo = new JsonlTaskRepository(missingPath)
    const err = await runFail(repo.findById("any-id"))
    expect(err._tag).toBe("not_found")
  })

  test("findByStatus() on missing file → empty array", async () => {
    await setup()
    const repo = new JsonlTaskRepository(missingPath)
    const result = await run(repo.findByStatus("backlog"))
    expect(result).toEqual([])
  })
})
