import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ContextEntry } from "@logbook/context/schema.js"
import type { Epic } from "@logbook/epic/schema.js"
import type { Story } from "@logbook/story/schema.js"
import type { Task } from "@logbook/task/schema.js"
import {
  ContextRepository,
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from "@logbook/workspace/repositories.js"
import { Effect } from "effect"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const makeTask = (): Task => ({
  id: "task-1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  epicId: "epic-1",
  storyId: "story-1",
  project: "migration",
  milestone: "task-04",
  title: "Implement repository",
  description: "Task body",
  definitionOfDone: "Done",
  status: "todo",
  priority: 1,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 3,
    complexity: "small",
    fibonacci: 3,
    confidence: "high",
  },
  contextEntryIds: ["context-1"],
  comments: [],
  externalLinks: [],
})

const makeEpic = (): Epic => ({
  id: "epic-1",
  schemaVersion: "2",
  kind: "epic",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Migration epic",
  description: "Epic body",
  outcome: "Stable storage",
  status: "active",
  storyIds: ["story-1"],
  contextEntryIds: ["context-1"],
  externalLinks: [],
})

const makeStory = (): Story => ({
  id: "story-1",
  schemaVersion: "2",
  kind: "story",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  epicId: "epic-1",
  title: "Repository contract",
  description: "Story body",
  userValue: "Reliable reads and writes",
  status: "ready",
  taskIds: ["task-1"],
  contextEntryIds: ["context-1"],
  externalLinks: [],
})

const makeContext = (): ContextEntry => ({
  id: "context-1",
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Storage notes",
  body: "Canonical JSONL rules",
  topics: ["storage"],
  attachedTo: [{ kind: "task", id: "task-1" }],
  relevanceHints: ["jsonl"],
})

describe("workspace file repositories", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("canonical repositories persist entities to their canonical JSONL files", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-04-e2e-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    const epicRepository = new EpicRepository({ workspaceRoot, initialized: true })
    const storyRepository = new StoryRepository({ workspaceRoot, initialized: true })
    const taskRepository = new TaskRepository({ workspaceRoot, initialized: true })
    const contextRepository = new ContextRepository({ workspaceRoot, initialized: true })

    await run(epicRepository.create(makeEpic()))
    await run(storyRepository.create(makeStory()))
    await run(taskRepository.create(makeTask()))
    await run(contextRepository.create(makeContext()))

    await expect(run(epicRepository.list())).resolves.toHaveLength(1)
    await expect(run(storyRepository.list())).resolves.toHaveLength(1)
    await expect(run(taskRepository.list())).resolves.toHaveLength(1)
    await expect(run(contextRepository.list())).resolves.toHaveLength(1)

    await expect(
      readFile(join(workspaceRoot, ".logbook/storage/epics.jsonl"), "utf8")
    ).resolves.toContain('"kind":"epic"')
    await expect(
      readFile(join(workspaceRoot, ".logbook/storage/stories.jsonl"), "utf8")
    ).resolves.toContain('"kind":"story"')
    await expect(
      readFile(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), "utf8")
    ).resolves.toContain('"kind":"task"')
    await expect(
      readFile(join(workspaceRoot, ".logbook/storage/context-entries.jsonl"), "utf8")
    ).resolves.toContain('"kind":"context_entry"')
  })

  test("canonical repositories treat missing initialized files as empty collections", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-04-e2e-empty-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    await expect(
      run(new EpicRepository({ workspaceRoot, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new StoryRepository({ workspaceRoot, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new TaskRepository({ workspaceRoot, initialized: true }).list())
    ).resolves.toEqual([])
    await expect(
      run(new ContextRepository({ workspaceRoot, initialized: true }).list())
    ).resolves.toEqual([])
  })

  test("task repository rewrites updates and tombstones deletes in canonical JSONL", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-task-05-e2e-tombstone-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })

    const taskRepository = new TaskRepository({ workspaceRoot, initialized: true })
    const created = makeTask()
    await run(taskRepository.create(created))

    const updated = {
      ...created,
      title: "Updated title",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }
    await run(taskRepository.update(updated))

    const tombstonedAt = "2026-01-03T00:00:00.000Z"
    await run(taskRepository.tombstone(created.id, tombstonedAt))

    await expect(run(taskRepository.list())).resolves.toEqual([])

    const contents = await readFile(join(workspaceRoot, ".logbook/storage/tasks.jsonl"), "utf8")
    const lines = contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      id: created.id,
      title: "Updated title",
      deletedAt: tombstonedAt,
      updatedAt: tombstonedAt,
    })
  })

  test("task port preserves malformed, invalid and unreadable storage errors on reads and writes", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-port-errors-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    const file = join(workspaceRoot, ".logbook/storage/tasks.jsonl")
    const port = new TaskRepository({ workspaceRoot, initialized: true }).asPort()
    for (const [content, tag] of [
      ["broken-json\n", "malformed_record"],
      ["{}\n", "validation_error"],
    ] as const) {
      await writeFile(file, content)
      for (const action of [
        port.findById("task-1"),
        port.save(makeTask()),
        port.update(makeTask()),
      ]) {
        expect(await run(Effect.either(action))).toMatchObject({
          _tag: "Left",
          left: { _tag: tag, filePath: file, taskId: "task-1" },
        })
      }
      expect(await readFile(file, "utf8")).toBe(content)
    }
    await chmod(file, 0o000)
    try {
      for (const action of [
        port.findById("task-1"),
        port.save(makeTask()),
        port.update(makeTask()),
      ]) {
        expect(await run(Effect.either(action))).toMatchObject({
          _tag: "Left",
          left: { _tag: "storage_error", filePath: file, cause: { code: "EACCES" } },
        })
      }
    } finally {
      await chmod(file, 0o600)
    }
  })

  test("task port preserves failed writes and actual missing/duplicate entity errors", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-port-write-errors-"))
    const storage = join(workspaceRoot, ".logbook/storage")
    await mkdir(storage, { recursive: true })
    const file = join(storage, "tasks.jsonl")
    const port = new TaskRepository({ workspaceRoot, initialized: true }).asPort()
    const task = makeTask()
    for (const action of [port.findById(task.id), port.update(task)]) {
      expect(await run(Effect.either(action))).toMatchObject({
        _tag: "Left",
        left: { _tag: "not_found", taskId: task.id },
      })
    }
    await run(port.save(task))
    expect(await run(Effect.either(port.save(task)))).toMatchObject({
      _tag: "Left",
      left: { _tag: "conflict", taskId: task.id },
    })
    const before = await readFile(file, "utf8")
    await chmod(file, 0o400)
    await chmod(storage, 0o555)
    try {
      for (const action of [
        port.save({ ...task, id: "task-2" }),
        port.update({ ...task, title: "Edit" }),
      ]) {
        expect(await run(Effect.either(action))).toMatchObject({
          _tag: "Left",
          left: { _tag: "storage_error", operation: "write", filePath: file },
        })
      }
      expect(await readFile(file, "utf8")).toBe(before)
    } finally {
      await chmod(storage, 0o755)
      await chmod(file, 0o600)
    }
  })
})
