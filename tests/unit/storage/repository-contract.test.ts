import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { JsonlRepository } from "@logbook/shared/storage/jsonl-repository.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
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

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-04",
  title: "Build canonical repository",
  description: "Implements the repository contract",
  definitionOfReady: "Spec approved",
  definitionOfDone: "Tests pass",
  status: "todo",
  priority: 1,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 3,
    complexity: "small",
    fibonacci: 3,
    confidence: "high",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

describe("JsonlRepository contract", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  const makeRepo = async (
    options: {
      initialized?: boolean
      maxValidationErrors?: number
      seedLines?: readonly string[]
    } = {}
  ) => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-04-unit-"))
    const filePath = join(workspaceRoot, ".logbook/storage/tasks.jsonl")
    await mkdir(dirname(filePath), { recursive: true })

    if (options.seedLines) {
      await writeFile(filePath, `${options.seedLines.join("\n")}\n`, "utf8")
    }

    return new JsonlRepository<Task>({
      entityName: "task",
      filePath,
      schema: TaskSchema,
      initialized: options.initialized,
      maxValidationErrors: options.maxValidationErrors,
    })
  }

  test("create, get, list, update, and tombstone operate over active records", async () => {
    const repo = await makeRepo({ initialized: true })
    const created = makeTask()

    await run(repo.create(created))
    await expect(run(repo.get(created.id))).resolves.toEqual(created)
    await expect(run(repo.list())).resolves.toEqual([created])

    const updated = {
      ...created,
      title: "Build canonical JSONL repository",
      updatedAt: "2026-01-02T00:00:00.000Z",
      status: "in_progress" as const,
    }

    await run(repo.update(updated))
    await expect(run(repo.get(updated.id))).resolves.toEqual(updated)

    const tombstoned = await run(repo.tombstone(updated.id, "2026-01-03T00:00:00.000Z"))
    expect(tombstoned.deletedAt).toBe("2026-01-03T00:00:00.000Z")
    expect(tombstoned.updatedAt).toBe("2026-01-03T00:00:00.000Z")
    await expect(run(repo.list())).resolves.toEqual([])
    await expect(runFail(repo.get(updated.id))).resolves.toMatchObject({
      _tag: "not_found",
      id: updated.id,
    })
  })

  test("malformed JSON returns malformed_record with file path and 1-based line", async () => {
    const repo = await makeRepo({
      initialized: true,
      seedLines: ['{"id":"task-1"', JSON.stringify(makeTask({ id: "task-2" }))],
    })

    await expect(runFail(repo.list())).resolves.toMatchObject({
      _tag: "malformed_record",
      filePath: expect.stringContaining(".logbook/storage/tasks.jsonl"),
      line: 1,
    })
  })

  test("schema-invalid lines return validation_error details with truncation", async () => {
    const repo = await makeRepo({
      initialized: true,
      maxValidationErrors: 2,
      seedLines: [
        JSON.stringify({ ...makeTask({ id: "task-1" }), title: 42 }),
        JSON.stringify({ ...makeTask({ id: "task-2" }), status: "not-a-status" }),
        JSON.stringify({ ...makeTask({ id: "task-3" }), priority: "high" }),
      ],
    })

    await expect(runFail(repo.list())).resolves.toMatchObject({
      _tag: "validation_error",
      filePath: expect.stringContaining(".logbook/storage/tasks.jsonl"),
      truncated: true,
      details: [
        { line: 1, filePath: expect.stringContaining(".logbook/storage/tasks.jsonl") },
        { line: 2, filePath: expect.stringContaining(".logbook/storage/tasks.jsonl") },
      ],
    })
  })

  test("duplicate active ids return conflict", async () => {
    const duplicateId = "task-duplicate"
    const repo = await makeRepo({
      initialized: true,
      seedLines: [
        JSON.stringify(makeTask({ id: duplicateId })),
        JSON.stringify(makeTask({ id: duplicateId, updatedAt: "2026-01-02T00:00:00.000Z" })),
      ],
    })

    await expect(runFail(repo.list())).resolves.toMatchObject({
      _tag: "conflict",
      id: duplicateId,
      filePath: expect.stringContaining(".logbook/storage/tasks.jsonl"),
    })
  })

  test("missing files read as empty only when initialized is true", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-04-missing-"))
    const filePath = join(workspaceRoot, ".logbook/storage/tasks.jsonl")

    const initializedRepo = new JsonlRepository<Task>({
      entityName: "task",
      filePath,
      schema: TaskSchema,
      initialized: true,
    })
    const uninitializedRepo = new JsonlRepository<Task>({
      entityName: "task",
      filePath,
      schema: TaskSchema,
    })

    await expect(run(initializedRepo.list())).resolves.toEqual([])
    await expect(runFail(uninitializedRepo.list())).resolves.toMatchObject({
      _tag: "storage_error",
      filePath,
    })
  })

  test("line byte bounds return malformed_record", async () => {
    const repo = await makeRepo({ initialized: true })
    const filePath = join(workspaceRoot!, ".logbook/storage/tasks.jsonl")
    await writeFile(filePath, `${"x".repeat(1_048_577)}\n`, "utf8")

    await expect(runFail(repo.list())).resolves.toMatchObject({
      _tag: "malformed_record",
      filePath,
      line: 1,
    })
  })

  test("scan line bounds return storage_error", async () => {
    const repo = await makeRepo({ initialized: true })
    const filePath = join(workspaceRoot!, ".logbook/storage/tasks.jsonl")
    const lines = Array.from({ length: 100_001 }, (_, index) =>
      JSON.stringify(makeTask({ id: `task-scan-${index}` }))
    )
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")

    await expect(runFail(repo.list())).resolves.toMatchObject({
      _tag: "storage_error",
      filePath,
    })
  })

  test("writes persist canonical JSONL lines", async () => {
    const repo = await makeRepo({ initialized: true })
    const task = makeTask()

    await run(repo.create(task))
    await run(repo.update({ ...task, updatedAt: "2026-01-02T00:00:00.000Z", title: "Updated" }))

    const contents = await readFile(join(workspaceRoot!, ".logbook/storage/tasks.jsonl"), "utf8")
    const lines = contents.split("\n").filter((line) => line.length > 0)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      id: task.id,
      title: "Updated",
    })
  })
})
