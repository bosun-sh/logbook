import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
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
})
