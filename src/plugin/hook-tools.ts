import { defineGroup, defineTool, plugin } from "@bosun-sh/ohtools"
import { type ListHooksInput, listHooks } from "@logbook/hook/list.js"
import { type RunHookInput, runHook } from "@logbook/hook/run.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asListHooksInput = (input: unknown): ListHooksInput =>
  isRecord(input)
    ? {
        ...(typeof input.event === "string" ? { event: input.event } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
      }
    : {}

const asRunHookInput = (input: unknown): RunHookInput =>
  isRecord(input)
    ? {
        hookId: typeof input.hookId === "string" ? input.hookId : "",
        event: typeof input.event === "string" ? input.event : "",
        ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
      }
    : { hookId: "", event: "" }

export const hookListTool = defineTool({
  id: "hook.list",
  description: "List configured Logbook v2 workspace hooks.",
  run: (input: unknown) => listHooks(asListHooksInput(input)),
})

export const hookRunTool = defineTool({
  id: "hook.run",
  description: "Run one configured Logbook v2 workspace hook.",
  run: (input: unknown) => runHook(asRunHookInput(input)),
})

const hookToolsGroup = defineGroup({ id: "hook", description: "Hook tools." }, (group) =>
  group.tool(hookListTool).tool(hookRunTool)
)

export const hookToolsPlugin = plugin("hook").group(hookToolsGroup)
