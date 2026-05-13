import { defineTool } from "@bosun-sh/ohtools"
import { type SetupLinearSyncInput, setupLinearSync } from "@logbook/sync/linear/setup.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asLinearSetupInput = (input: unknown): SetupLinearSyncInput =>
  isRecord(input)
    ? {
        ...(typeof input.teamUrl === "string" ? { teamUrl: input.teamUrl } : {}),
        ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
        ...(typeof input.teamId === "string" ? { teamId: input.teamId } : {}),
        ...(typeof input.teamKey === "string" ? { teamKey: input.teamKey } : {}),
        ...(typeof input.projectId === "string" ? { projectId: input.projectId } : {}),
        ...(typeof input.apiTokenEnv === "string" ? { apiTokenEnv: input.apiTokenEnv } : {}),
        ...(typeof input.apiToken === "string" ? { apiToken: input.apiToken } : {}),
        ...(typeof input.writeEnv === "boolean" ? { writeEnv: input.writeEnv } : {}),
        ...(typeof input.checkProvider === "boolean" ? { checkProvider: input.checkProvider } : {}),
      }
    : {}

export const linearSetupTool = defineTool({
  id: "sync.linear.setup",
  description: "Configure Linear sync for this workspace.",
  run: (input: unknown) => setupLinearSync(asLinearSetupInput(input)),
})
