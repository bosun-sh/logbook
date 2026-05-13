import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TaskSchema } from "@logbook/task/schema.js"
import { migrateV1Workspace } from "@logbook/workspace/migrate-v1.js"
import { translateV1TaskArgs } from "@logbook/workspace/v1-cli-task.js"
import { Effect } from "effect"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const makeV1Task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-v1",
  project: "migration",
  milestone: "m1",
  title: "Migrate workspace",
  description: "Move the legacy JSONL store.",
  definition_of_done: ["v2 file exists", "", "legacy file remains"],
  test_cases: ["migration smoke passes"],
  assigned_session: "session-1",
  assignee: {
    id: "agent-1",
    title: "Migration Agent",
    description: "Owns the import.",
  },
  assigned_model: "gpt-5.3-codex",
  estimation: 8,
  predictedKTokens: 13,
  comments: [
    {
      id: "comment-1",
      title: "Status",
      content: "Ready to migrate.",
      kind: "regular",
      timestamp: "2026-01-02T03:04:05Z",
      reply: "Acknowledged.",
    },
  ],
  status: "in_progress",
  priority: 3,
  in_progress_since: "2026-01-02T03:00:00Z",
  ...overrides,
})

const withWorkspace = async <T>(fn: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "logbook-v1-mapping-"))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe("v1 CLI task argument mapping", () => {
  test("translateV1TaskArgs maps create-task aliases to v2 fields", () => {
    const translated = translateV1TaskArgs("create-task", {
      "definition-of-done": "ship",
      "test-cases": "case",
      "predicted-k-tokens": "8",
      "assigned-session": "session-1",
      "assigned-model": "gpt-5",
      estimation: "5",
    })

    expect(translated).toEqual({
      definition_of_done: ["ship"],
      test_cases: ["case"],
      predictedKTokens: 8,
      assigned_session: "session-1",
      assigned_model: "gpt-5",
      estimation: 5,
    })
  })

  test("translateV1TaskArgs maps update-task aliases", () => {
    const translated = translateV1TaskArgs("update-task", {
      "new-status": "in_progress",
      "comment-title": "title",
      "comment-content": "content",
      "comment-reply-to": "comment-1",
    })

    expect(translated).toEqual({
      new_status: "in_progress",
      comment_title: "title",
      comment_content: "content",
      comment_reply_to: "comment-1",
    })
  })
})

describe("v1 workspace task migration mapping", () => {
  test("migrates a representative v1 record into a valid v2 task", async () => {
    await withWorkspace(async (root) => {
      const source = join(root, "tasks.jsonl")
      const target = join(root, ".logbook/storage/tasks.jsonl")
      await writeFile(source, `${JSON.stringify(makeV1Task())}\n`, "utf8")

      const result = await run(migrateV1Workspace({ path: root, now: "2026-02-03T04:05:06.000Z" }))

      expect(result).toMatchObject({
        ok: true,
        data: {
          migrated: true,
          taskCount: 1,
        },
        warnings: [
          {
            code: "missing_created_at",
          },
        ],
      })

      const [line] = (await readFile(target, "utf8")).trim().split("\n")
      const parsed = TaskSchema.parse(JSON.parse(line ?? "{}"))
      expect(parsed).toMatchObject({
        id: "task-v1",
        schemaVersion: "2",
        kind: "task",
        createdAt: "2026-02-03T04:05:06.000Z",
        updatedAt: "2026-02-03T04:05:06.000Z",
        project: "migration",
        milestone: "m1",
        title: "Migrate workspace",
        description: "Move the legacy JSONL store.",
        definitionOfDone: "v2 file exists\nlegacy file remains",
        definitionOfReady: "migration smoke passes",
        status: "in_progress",
        priority: 3,
        sessionId: "session-1",
        assignee: {
          id: "agent-1",
          title: "Migration Agent",
          description: "Owns the import.",
        },
        model: { id: "gpt-5.3-codex" },
        estimate: {
          predictedKTokens: 13,
          fibonacci: 8,
          complexity: "medium",
          confidence: "medium",
        },
      })
      expect(parsed.epicId).toBeUndefined()
      expect(parsed.storyId).toBeUndefined()
      expect(parsed.comments[0]?.createdAt).toBe("2026-01-02T03:04:05.000Z")
      expect(parsed.comments[0]?.replies[0]?.createdAt).toBe("2026-01-02T03:04:05.000Z")
    })
  })

  test("returns malformed_record with file path and line number for invalid JSON", async () => {
    await withWorkspace(async (root) => {
      await writeFile(
        join(root, "tasks.jsonl"),
        `${JSON.stringify(makeV1Task())}\n{bad-json\n`,
        "utf8"
      )

      const result = await run(migrateV1Workspace({ path: root, now: "2026-02-03T04:05:06.000Z" }))

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "malformed_record",
          details: {
            filePath: join(root, "tasks.jsonl"),
            line: 2,
          },
        },
      })
    })
  })

  test("returns validation_error details and truncates after 50 invalid records", async () => {
    await withWorkspace(async (root) => {
      const invalidLines = Array.from({ length: 51 }, (_, index) =>
        JSON.stringify(makeV1Task({ id: `task-${index}`, definition_of_done: [] }))
      )
      await writeFile(join(root, "tasks.jsonl"), `${invalidLines.join("\n")}\n`, "utf8")

      const result = await run(migrateV1Workspace({ path: root, now: "2026-02-03T04:05:06.000Z" }))

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "validation_error",
          details: {
            filePath: join(root, "tasks.jsonl"),
            truncated: true,
          },
        },
      })
      if (!result.ok) {
        expect((result.error.details?.details as unknown[] | undefined)?.length).toBe(50)
      }
    })
  })

  test("rejects duplicate migrated task IDs before writing v2 storage", async () => {
    await withWorkspace(async (root) => {
      const sourceLines = [
        JSON.stringify(makeV1Task({ title: "First duplicate" })),
        JSON.stringify(makeV1Task({ title: "Second duplicate" })),
      ]
      await writeFile(join(root, "tasks.jsonl"), `${sourceLines.join("\n")}\n`, "utf8")

      const result = await run(migrateV1Workspace({ path: root, now: "2026-02-03T04:05:06.000Z" }))

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "validation_error",
          details: {
            details: [
              {
                line: 2,
                issues: [expect.stringContaining("Duplicate task id task-v1")],
              },
            ],
          },
        },
      })
      await expect(readFile(join(root, ".logbook/storage/tasks.jsonl"), "utf8")).rejects.toThrow()
    })
  })
})
