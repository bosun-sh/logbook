import { defineTool } from "@bosun-sh/ohtools"
import { pullLinearSync } from "@logbook/sync/linear/pull.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asLinearPullInput = (input: unknown) =>
  isRecord(input)
    ? {
        ...(typeof input.since === "string" ? { since: input.since } : {}),
        ...(typeof input.teamId === "string" ? { teamId: input.teamId } : {}),
        ...(typeof input.projectId === "string" ? { projectId: input.projectId } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(isRecord(input.cursor) ? { cursor: input.cursor as never } : {}),
        dryRun: input.dryRun === true,
      }
    : { dryRun: false }

export const linearPullTool = defineTool({
  id: "sync.linear.pull",
  description: "Pull Linear issues into Logbook.",
  run: (input: unknown) => pullLinearSync(asLinearPullInput(input)),
})
