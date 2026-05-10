import { defineTool } from "@bosun-sh/ohtools"
import type { ToolResult } from "@logbook/shared/result.js"
import { listSyncConflicts, resolveSyncConflict } from "@logbook/sync/conflicts.js"
import { appendSyncEvent } from "@logbook/sync/events.js"
import type { SyncConflict } from "@logbook/sync/schema.js"
import { Effect } from "effect"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asListSyncConflictsInput = (input: unknown): unknown =>
  isRecord(input)
    ? {
        ...(typeof input.provider === "string" ? { provider: input.provider } : {}),
        ...(typeof input.status === "string" ? { status: input.status } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
      }
    : {}

const asResolveSyncConflictInput = (input: unknown): unknown =>
  isRecord(input)
    ? {
        id: typeof input.id === "string" ? input.id : "",
        resolution: typeof input.resolution === "string" ? input.resolution : "",
        ...(isRecord(input.manualRecord) ? { manualRecord: input.manualRecord } : {}),
      }
    : { id: "", resolution: "" }

type ResolveConflictToolResult = {
  readonly conflict: SyncConflict
  readonly event: unknown
}

export const listSyncConflictsTool = defineTool({
  id: "sync.conflicts.list",
  description: "List Logbook sync conflicts.",
  run: (input: unknown) => listSyncConflicts(asListSyncConflictsInput(input) as never),
})

export const resolveSyncConflictTool = defineTool({
  id: "sync.conflicts.resolve",
  description: "Resolve one Logbook sync conflict.",
  run: (input: unknown) =>
    Effect.gen(function* () {
      const resolved = yield* resolveSyncConflict(asResolveSyncConflictInput(input) as never)
      if (!resolved.ok) {
        return resolved
      }

      const appended = yield* appendSyncEvent({
        direction: "resolve",
        data: {
          ...resolved.data.event,
          fields: [...resolved.data.event.fields],
        },
      })
      if (!appended.ok) {
        return appended
      }

      return {
        ok: true,
        data: {
          conflict: resolved.data.conflict,
          event: appended.data.syncEvent,
        },
      } satisfies ToolResult<ResolveConflictToolResult>
    }),
})
