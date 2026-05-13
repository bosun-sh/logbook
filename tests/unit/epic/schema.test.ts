import { describe, expect, test } from "bun:test"
import { EpicSchema } from "@logbook/epic/schema.js"
import type { z } from "zod"

const epicRecord: z.input<typeof EpicSchema> = {
  id: "epic_1",
  schemaVersion: "2",
  kind: "epic",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  title: "Migration foundation",
  description: "Shared migration work",
  outcome: "Stable v2 base",
  status: "active",
  owner: {
    id: "agent_1",
    title: "Owner",
  },
  storyIds: ["story_1"],
  contextEntryIds: ["context_entry_1"],
  externalLinks: [{ provider: "linear", externalLinkId: "external_link_1" }],
}

describe("EpicSchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = EpicSchema.parse(epicRecord)

    expect(parsed).toEqual(epicRecord)
  })

  test("rejects titles above the byte limit", () => {
    expect(() =>
      EpicSchema.parse({
        ...epicRecord,
        title: "a".repeat(513),
      })
    ).toThrow()
  })
})
