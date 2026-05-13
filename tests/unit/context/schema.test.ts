import { describe, expect, test } from "bun:test"
import { ContextEntrySchema, ExternalLinkSchema } from "@logbook/context/schema.js"
import type { z } from "zod"

const contextEntryRecord: z.input<typeof ContextEntrySchema> = {
  id: "context_entry_1",
  schemaVersion: "2",
  kind: "context_entry",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  title: "Architecture note",
  body: "Entity schemas live under screaming architecture roots",
  topics: ["architecture", "schemas"],
  source: {
    type: "manual",
    recordId: "task_1",
  },
  attachedTo: [
    { kind: "epic", id: "epic_1" },
    { kind: "topic", id: "schemas" },
  ],
  relevanceHints: ["task-03", "task-04"],
}

const externalLinkRecord: z.input<typeof ExternalLinkSchema> = {
  id: "external_link_1",
  schemaVersion: "2",
  kind: "external_link",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  provider: "linear",
  localRecord: {
    kind: "task",
    id: "task_1",
  },
  remoteRecord: {
    id: "LIN-123",
    url: "https://linear.app/example/issue/LIN-123",
    type: "issue",
  },
  lastSyncedAt: "2026-01-02T00:00:00.000Z",
  lastSeenRemoteVersion: "42",
  lastPushedLocalVersion: "41",
}

describe("ContextEntrySchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = ContextEntrySchema.parse(contextEntryRecord)

    expect(parsed).toEqual(contextEntryRecord)
  })
})

describe("ExternalLinkSchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = ExternalLinkSchema.parse(externalLinkRecord)

    expect(parsed).toEqual(externalLinkRecord)
  })

  test("rejects unknown remote record fields", () => {
    expect(() =>
      ExternalLinkSchema.parse({
        ...externalLinkRecord,
        remoteRecord: {
          ...externalLinkRecord.remoteRecord,
          extra: true,
        },
      })
    ).toThrow()
  })
})
