import { describe, expect, test } from "bun:test"
import type { Task } from "@logbook/task/schema.js"
import { fromV1TaskInput, toV1Task } from "@logbook/task/v1-compat.js"

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  project: "migration",
  milestone: "task-09",
  title: "Compat mapping",
  description: "map v1 and v2 fields",
  definitionOfDone: "line one\nline two",
  definitionOfReady: "test a\ntest b",
  status: "in_progress",
  priority: 3,
  sessionId: "session-1",
  model: { id: "gpt-5-mini" },
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 8,
    complexity: "medium",
    fibonacci: 5,
    confidence: "high",
  },
  comments: [
    {
      id: "comment-1",
      title: "Need info",
      content: "question",
      kind: "need_info",
      createdAt: "2026-01-03T00:00:00.000Z",
      replies: [{ id: "reply-1", content: "answer", createdAt: "2026-01-03T01:00:00.000Z" }],
    },
  ],
  contextEntryIds: [],
  externalLinks: [],
  inProgressSince: "2026-01-03T00:00:00.000Z",
  ...overrides,
})

describe("v1 compatibility task mapping", () => {
  test("toV1Task maps v2 task aliases and derived fields", () => {
    const v1 = toV1Task(baseTask())

    expect(v1.definition_of_done).toEqual(["line one", "line two"])
    expect(v1.test_cases).toEqual(["test a", "test b"])
    expect(v1.assigned_session).toBe("session-1")
    expect(v1.assigned_model).toBe("gpt-5-mini")
    expect(v1.estimation).toBe(5)
    expect(v1.predictedKTokens).toBe(8)
    expect(v1.comments[0]?.timestamp).toBe("2026-01-03T00:00:00.000Z")
    expect(v1.comments[0]?.reply).toBe("answer")
    expect(v1.in_progress_since).toBe("2026-01-03T00:00:00.000Z")
  })

  test("fromV1TaskInput maps v1 record to v2 task and appends test_cases to definitionOfReady", () => {
    const result = fromV1TaskInput(
      {
        id: "legacy-1",
        project: "migration",
        milestone: "task-09",
        title: "legacy",
        description: "legacy desc",
        definition_of_done: ["done 1", "done 2"],
        test_cases: ["case 1", "case 2"],
        assigned_session: "session-2",
        assigned_model: "gpt-5",
        estimation: 8,
        predictedKTokens: 13,
        status: "todo",
        priority: 2,
        comments: [
          {
            id: "comment-a",
            title: "legacy comment",
            content: "legacy content",
            kind: "need_info",
            timestamp: "2026-01-04T00:00:00.000Z",
            reply: "legacy reply",
          },
        ],
      },
      { now: "2026-01-08T00:00:00.000Z" }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")

    expect(result.data.definitionOfDone).toBe("done 1\ndone 2")
    expect(result.data.definitionOfReady).toBe("case 1\ncase 2")
    expect(result.data.sessionId).toBe("session-2")
    expect(result.data.model).toEqual({ id: "gpt-5" })
    expect(result.data.estimate.fibonacci).toBe(8)
    expect(result.data.estimate.predictedKTokens).toBe(13)
    expect(result.data.comments[0]?.replies[0]?.content).toBe("legacy reply")
  })

  test("invalid JSON string record returns malformed_record", () => {
    const result = fromV1TaskInput("{invalid-json")
    expect(result).toEqual({
      ok: false,
      error: { code: "malformed_record", message: "v1 task record is not valid JSON" },
    })
  })

  test("schema-invalid v1 record returns validation_error", () => {
    const result = fromV1TaskInput({
      id: "legacy-1",
      project: "migration",
      milestone: "task-09",
      title: "legacy",
      description: "legacy desc",
      definition_of_done: [],
      estimation: 8,
      status: "todo",
      comments: [],
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected validation error")
    expect(result.error.code).toBe("validation_error")
  })

  test("returns validation_error when v1-valid record maps to v2-invalid task", () => {
    const oversized = "x".repeat(65_537)
    const result = fromV1TaskInput({
      id: "legacy-2",
      project: "migration",
      milestone: "task-09",
      title: "legacy",
      description: "legacy desc",
      definition_of_done: [oversized],
      estimation: 8,
      status: "todo",
      comments: [],
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected validation error")
    expect(result.error.code).toBe("validation_error")
    expect(result.error.details).toMatchObject({
      issues: [expect.stringContaining("definitionOfDone exceeds 65536 bytes")],
    })
  })
})
