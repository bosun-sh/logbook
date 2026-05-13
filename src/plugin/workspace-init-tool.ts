import { defineTool } from "@bosun-sh/ohtools"
import { initWorkspace, type WorkspaceInitInput } from "@logbook/workspace/init.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asWorkspaceInitInput = (input: unknown): WorkspaceInitInput =>
  isRecord(input)
    ? {
        ...(typeof input.path === "string" ? { path: input.path } : {}),
        ...(typeof input.force === "boolean" ? { force: input.force } : {}),
        ...(typeof input.migrateV1 === "boolean" ? { migrateV1: input.migrateV1 } : {}),
      }
    : {}

export const workspaceInitTool = defineTool({
  id: "workspace.init",
  description: "Initialize a Logbook v2 workspace layout.",
  run: (input: unknown) => initWorkspace(asWorkspaceInitInput(input)),
})
