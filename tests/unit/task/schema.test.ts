import { describe, expect, test } from "bun:test"
import { TaskSchema } from "@logbook/task/schema.js"
import type { z } from "zod"

const taskRecord: z.input<typeof TaskSchema> = {
  id: "task_1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  epicId: "epic_1",
  storyId: "story_1",
  project: "logbook",
  milestone: "v2",
  title: "Implement entity schemas",
  description: "Add schema modules and tests",
  definitionOfReady: "Spec is ready",
  definitionOfDone: "All entity schemas validate",
  status: "in_progress",
  priority: 2,
  assignee: {
    id: "agent_1",
    title: "Implementer",
  },
  sessionId: "session_1",
  model: {
    id: "gpt-5",
    provider: "openai",
  },
  phaseModelOverrides: {
    test: {
      id: "gpt-5",
      provider: "openai",
    },
  },
  estimate: {
    predictedKTokens: 8,
    complexity: "medium",
    fibonacci: 3,
    confidence: "high",
  },
  currentPhase: "dev",
  contextEntryIds: ["context_entry_1"],
  comments: [
    {
      id: "comment_1",
      title: "Work note",
      content: "Implementation in progress",
      kind: "regular",
      createdAt: "2026-01-02T00:00:00.000Z",
      author: {
        id: "agent_1",
        title: "Implementer",
      },
      replies: [
        {
          id: "reply_1",
          content: "Acknowledged",
          createdAt: "2026-01-02T01:00:00.000Z",
        },
      ],
    },
  ],
  inProgressSince: "2026-01-02T00:00:00.000Z",
  externalLinks: [{ provider: "linear", externalLinkId: "external_link_1" }],
}

describe("TaskSchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = TaskSchema.parse(taskRecord)

    expect(parsed).toEqual(taskRecord)
  })

  test("rejects definitionOfDone above the byte limit", () => {
    expect(() =>
      TaskSchema.parse({
        ...taskRecord,
        definitionOfDone: "a".repeat(65_537),
      })
    ).toThrow()
  })
})
