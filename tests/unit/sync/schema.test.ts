import { describe, expect, test } from "bun:test"
import { SyncConflictSchema, SyncEventSchema } from "@logbook/sync/schema.js"
import type { z } from "zod"

const syncEventRecord: z.input<typeof SyncEventSchema> = {
  id: "sync_event_1",
  schemaVersion: "2",
  kind: "sync_event",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  provider: "linear",
  direction: "pull",
  localRecordId: "task_1",
  remoteRecordId: "LIN-123",
  result: "updated",
  message: "Pulled remote changes",
  data: {
    changedFields: ["title"],
  },
}

const syncConflictRecord: z.input<typeof SyncConflictSchema> = {
  id: "sync_conflict_1",
  schemaVersion: "2",
  kind: "sync_conflict",
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
  },
  fields: [
    {
      path: "title",
      localValue: "Local title",
      remoteValue: "Remote title",
      baseValue: "Base title",
    },
  ],
  status: "open",
  resolution: "manual",
  resolvedAt: "2026-01-02T00:00:00.000Z",
}

describe("SyncEventSchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = SyncEventSchema.parse(syncEventRecord)

    expect(parsed).toEqual(syncEventRecord)
  })
})

describe("SyncConflictSchema", () => {
  test("round-trips the canonical entity shape", () => {
    const parsed = SyncConflictSchema.parse(syncConflictRecord)

    expect(parsed).toEqual(syncConflictRecord)
  })

  test("rejects invalid conflict status", () => {
    expect(() =>
      SyncConflictSchema.parse({
        ...syncConflictRecord,
        status: "closed",
      })
    ).toThrow()
  })
})
