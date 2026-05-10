import { describe, expect, test } from "bun:test"
import {
  AssignmentSchema,
  CommentSchema,
  ContextAttachmentSchema,
  EntityMetaSchema,
  ExternalLinkRefSchema,
  ModelAssignmentSchema,
  TaskEstimateSchema,
  TaskPhaseModelOverridesSchema,
} from "@logbook/shared/schema/value-objects.js"

const repeated = (char: string, count: number): string => char.repeat(count)

describe("shared entity schemas", () => {
  test("entity meta accepts canonical v2 envelope fields", () => {
    const parsed = EntityMetaSchema.parse({
      id: "task_123",
      schemaVersion: "2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: "2026-01-03T00:00:00.000Z",
    })

    expect(parsed.schemaVersion).toBe("2")
  })

  test("assignment and model assignment are strict objects", () => {
    expect(() =>
      AssignmentSchema.parse({
        id: "agent_1",
        title: "Owner",
        extra: true,
      })
    ).toThrow()

    expect(() =>
      ModelAssignmentSchema.parse({
        id: "gpt-5",
        provider: "openai",
        extra: true,
      })
    ).toThrow()
  })

  test("task estimate validates the canonical enums", () => {
    const parsed = TaskEstimateSchema.parse({
      predictedKTokens: 8,
      complexity: "medium",
      fibonacci: 3,
      confidence: "high",
      rationale: "Based on expected implementation and tests",
    })

    expect(parsed.fibonacci).toBe(3)
  })

  test("phase model overrides only allow canonical phase keys", () => {
    expect(() =>
      TaskPhaseModelOverridesSchema.parse({
        deploy: { id: "gpt-5" },
      })
    ).toThrow()
  })

  test("comment enforces title and content byte bounds", () => {
    expect(() =>
      CommentSchema.parse({
        id: "comment_1",
        title: repeated("a", 513),
        content: "content",
        kind: "regular",
        createdAt: "2026-01-01T00:00:00.000Z",
        replies: [],
      })
    ).toThrow()

    expect(() =>
      CommentSchema.parse({
        id: "comment_1",
        title: "valid",
        content: repeated("a", 65_537),
        kind: "regular",
        createdAt: "2026-01-01T00:00:00.000Z",
        replies: [],
      })
    ).toThrow()
  })

  test("context attachments and external link refs parse canonical shapes", () => {
    const attachment = ContextAttachmentSchema.parse({
      kind: "topic",
      id: "topic_1",
    })
    const link = ExternalLinkRefSchema.parse({
      provider: "linear",
      externalLinkId: "external_link_1",
    })

    expect(attachment.kind).toBe("topic")
    expect(link.provider).toBe("linear")
  })
})
