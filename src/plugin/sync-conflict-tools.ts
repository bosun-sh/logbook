import { defineGroup, plugin } from "@bosun-sh/ohtools"
import { listSyncConflictsTool, resolveSyncConflictTool } from "@logbook/sync/conflict-tools.js"

const syncConflictToolsGroup = defineGroup({ id: "sync", description: "Sync tools." }, (group) =>
  group.tool(listSyncConflictsTool).tool(resolveSyncConflictTool)
)

export const syncConflictToolsPlugin = plugin("sync").group(syncConflictToolsGroup)
