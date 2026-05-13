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

describe("v1 CLI aliases", () => {
  test("create-task and list-tasks call v2 handlers with compatibility mapping", async () => {
    const repo = new InMemoryTaskRepository()
    const layer = makeLayer(repo) as unknown as RunCliOptions["layer"]
    let createStdout = ""

    const createExitCode = await runCli(
      [
        "create-task",
        "--title",
        "Preserve v1 aliases",
        "--description",
        "Legacy command routes through task.create.",
        "--definition-of-done",
        JSON.stringify(["Legacy create works", "Compatibility warning is emitted"]),
        "--test-cases",
        JSON.stringify(["Legacy smoke test passes", "Legacy regression test passes"]),
        "--project",
        "migration",
        "--milestone",
        "task-25",
        "--assigned-session",
        "session-legacy",
        "--assigned-model",
        "gpt-5.4",
        "--estimation",
        "5",
        "--predictedKTokens",
        "12",
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
    expect(created).toMatchObject({
      ok: true,
      data: {
        task: {
          title: "Preserve v1 aliases",
          definitionOfDone: "Legacy create works\nCompatibility warning is emitted",
          definitionOfReady: "Legacy smoke test passes\nLegacy regression test passes",
          sessionId: "session-legacy",
          model: { id: "gpt-5.4" },
          estimate: {
            predictedKTokens: 12,
            fibonacci: 5,
            complexity: "small",
            confidence: "medium",
          },
        },
        compat: {
          v1: {
            task: {
              title: "Preserve v1 aliases",
              definition_of_done: ["Legacy create works", "Compatibility warning is emitted"],
              test_cases: ["Legacy smoke test passes", "Legacy regression test passes"],
              assigned_session: "session-legacy",
              assigned_model: "gpt-5.4",
              estimation: 5,
              predictedKTokens: 12,
            },
          },
        },
      },
      warnings: [
        expect.objectContaining({
          code: "compatibility_mapping_applied",
        }),
      ],
    })

    let listStdout = ""
    const listExitCode = await runCli(["list-tasks", "--status", "*"], {
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
      },
    })
  })

  test("update-task, edit-task, current-task, and init stay registered as retained aliases", async () => {
    const aliases = [
      { alias: "update-task", expectedExitCode: 1 },
      { alias: "edit-task", expectedExitCode: 1 },
      { alias: "current-task", expectedExitCode: 1 },
      { alias: "init", expectedExitCode: 0 },
    ]

    for (const { alias, expectedExitCode } of aliases) {
      let stdout = ""
      const exitCode = await runCli([alias], {
        layer: makeLayer(new InMemoryTaskRepository()) as unknown as RunCliOptions["layer"],
        stdout: (chunk) => {
          stdout += chunk
        },
      })

      expect(exitCode).toBe(expectedExitCode)
      const envelope = parseEnvelope(stdout)
      if (!envelope.ok) {
        expect(envelope.error.code).not.toBe("cli_parse_error")
      }
    }
  })
})
