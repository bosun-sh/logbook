import { describe, expect, test } from "bun:test"
import type { Story } from "@logbook/story/schema.js"
import { TaskRepository } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { type RunCliOptions, runCli } from "@logbook/workspace/cli-adapter.js"
import { SessionLivenessPort } from "@logbook/workspace/session-liveness.js"
import { Context, Effect, Layer } from "effect"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

class InMemoryTaskRepository implements TaskRepositoryShape {
  private readonly store = new Map<string, Task>()

  findById(id: string) {
    const task = this.store.get(id)
    return task === undefined
      ? Effect.fail({ _tag: "not_found", message: `task ${id} was not found`, id })
      : Effect.succeed(task)
  }

  findByStatus(status: Task["status"] | "*") {
    const tasks = [...this.store.values()]
    return Effect.succeed(status === "*" ? tasks : tasks.filter((task) => task.status === status))
  }

  save(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task) {
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }
}

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

class InMemoryStoryRepository implements StoryRepositoryShape {
  create(story: Story) {
    return Effect.succeed(story)
  }

  get(id: string) {
    return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
  }

  list() {
    return Effect.succeed([])
  }

  update(story: Story) {
    return Effect.succeed(story)
  }

  tombstone(id: string) {
    return Effect.fail({ _tag: "not_found", message: `story ${id} was not found`, id })
  }
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const makeLayer = (repo: InMemoryTaskRepository) =>
  Layer.mergeAll(
    Layer.succeed(
      TaskRepository,
      repo as unknown as import("@logbook/task/ports.js").TaskRepository
    ),
    Layer.succeed(StoryRepository, new InMemoryStoryRepository()),
    Layer.succeed(SessionLivenessPort, {
      isAlive: () => Effect.succeed(false),
    })
  )

const parseEnvelope = (stdout: string): any => {
  const lines = stdout.trim().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? "{}")
}

describe("task v2 CLI commands", () => {
  test("creates and lists tasks through colon-style aliases", async () => {
    const repo = new InMemoryTaskRepository()
    const layer = makeLayer(repo) as unknown as RunCliOptions["layer"]
    let createStdout = ""

    const createExitCode = await runCli(
      [
        "task:create",
        "--title",
        "Implement CLI adapter",
        "--description",
        "Dispatch CLI commands through Ohtools.",
        "--definitionOfDone",
        "CLI calls the shared handler.",
        "--project",
        "migration",
        "--milestone",
        "task-24",
        "--priority",
        "3",
      ],
      {
        layer,
        stdout: (chunk) => {
          createStdout += chunk
        },
      }
    )

    expect(createExitCode).toBe(0)
    const created = parseEnvelope(createStdout)
    expect(created.ok).toBe(true)
    expect(created.data.task).toMatchObject({
      title: "Implement CLI adapter",
      project: "migration",
      milestone: "task-24",
      status: "backlog",
      priority: 3,
    })

    let listStdout = ""
    const listExitCode = await runCli(["task:list", "--status", "*"], {
      layer,
      stdout: (chunk) => {
        listStdout += chunk
      },
    })

    expect(listExitCode).toBe(0)
    expect(parseEnvelope(listStdout)).toMatchObject({
      ok: true,
      data: {
        items: [expect.objectContaining({ id: created.data.task.id })],
        hasMore: false,
      },
    })
  })

  test("merges stdin JSON into object-rooted task input", async () => {
    const repo = new InMemoryTaskRepository()
    let stdout = ""

    const exitCode = await runCli(["task:create"], {
      layer: makeLayer(repo) as unknown as RunCliOptions["layer"],
      stdin: JSON.stringify({
        title: "Create from stdin",
        description: "Use JSON input.",
        definitionOfDone: "stdin JSON becomes the tool input.",
        project: "migration",
        milestone: "task-24",
      }),
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(parseEnvelope(stdout)).toMatchObject({
      ok: true,
      data: {
        task: expect.objectContaining({
          title: "Create from stdin",
          project: "migration",
        }),
      },
    })
  })

  test("returns nonzero with one JSON error envelope when the handler fails", async () => {
    let stdout = ""
    const exitCode = await runCli(["task:create", "--title", "Missing required fields"], {
      layer: makeLayer(new InMemoryTaskRepository()) as unknown as RunCliOptions["layer"],
      stdout: (chunk) => {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(1)
    expect(parseEnvelope(stdout)).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
  })
})
