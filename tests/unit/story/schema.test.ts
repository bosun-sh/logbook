import { describe, expect, test } from "bun:test"
import { StorySchema } from "@logbook/story/schema.js"
import type { z } from "zod"

const storyRecord: z.input<typeof StorySchema> = {
  id: "story_1",
  schemaVersion: "2",
  kind: "story",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  epicId: "epic_1",
  title: "Schema migration",
  description: "Implement the entity schemas",
  userValue: "Safer migration delivery",
  status: "ready",
  taskIds: ["task_1"],
  contextEntryIds: ["context_entry_1"],
  externalLinks: [{ provider: "linear", externalLinkId: "external_link_1" }],
}

describe("StorySchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = StorySchema.parse(storyRecord)

    expect(parsed).toEqual(storyRecord)
  })

  test("rejects unknown fields", () => {
    expect(() =>
      StorySchema.parse({
        ...storyRecord,
        unexpected: true,
      })
    ).toThrow()
  })
})
