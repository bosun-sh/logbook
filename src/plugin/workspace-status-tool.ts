import { defineTool } from "@bosun-sh/ohtools"
import { getWorkspaceStatus, type WorkspaceStatusInput } from "@logbook/workspace/status.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asWorkspaceStatusInput = (input: unknown): WorkspaceStatusInput =>
  isRecord(input)
    ? {
        ...(typeof input.path === "string" ? { path: input.path } : {}),
        ...(input.checkProvider === false ? { checkProvider: false } : {}),
      }
    : {}

export const workspaceStatusTool = defineTool({
  id: "workspace.status",
  description: "Report Logbook v2 workspace readiness.",
  run: (input: unknown) => getWorkspaceStatus(asWorkspaceStatusInput(input)),
})
