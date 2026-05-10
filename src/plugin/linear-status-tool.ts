import { defineTool } from "@bosun-sh/ohtools"
import { type GetLinearStatusInput, getLinearStatus } from "@logbook/sync/linear/status.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asLinearStatusInput = (input: unknown): GetLinearStatusInput =>
  isRecord(input) && input.checkProvider === false ? { checkProvider: false } : {}

export const linearStatusTool = defineTool({
  id: "sync.linear.status",
  description: "Report Linear sync readiness and health.",
  run: (input: unknown) => getLinearStatus(asLinearStatusInput(input)),
})
