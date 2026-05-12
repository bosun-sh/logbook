import {
  type DefinedGroup,
  type DefinedTool,
  defineGroup,
  defineTool,
  type OhtoolsPlugin,
  plugin,
} from "@bosun-sh/ohtools"
import { attachContext, detachContext } from "@logbook/context/attachments.js"
import { createContextEntry } from "@logbook/context/create.js"
import { deleteContextEntry } from "@logbook/context/delete.js"
import { getContextEntry } from "@logbook/context/get.js"
import { listContextEntries } from "@logbook/context/list.js"
import { searchContextEntries } from "@logbook/context/search.js"
import { updateContextEntry } from "@logbook/context/update.js"
import { createEpic } from "@logbook/epic/create.js"
import { deleteEpic } from "@logbook/epic/delete.js"
import { getEpic } from "@logbook/epic/get.js"
import { listEpics } from "@logbook/epic/list.js"
import { updateEpic } from "@logbook/epic/update.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { createStory } from "@logbook/story/create.js"
import { deleteStory } from "@logbook/story/delete.js"
import { getStory } from "@logbook/story/get.js"
import { listStories } from "@logbook/story/list.js"
import { updateStory } from "@logbook/story/update.js"
import { listSyncConflictsTool, resolveSyncConflictTool } from "@logbook/sync/conflict-tools.js"
import { createTask } from "@logbook/task/create.js"
import { getCurrentTask } from "@logbook/task/current.js"
import { editTask } from "@logbook/task/edit.js"
import { estimateTask } from "@logbook/task/estimate.js"
import { getTask } from "@logbook/task/get.js"
import { listTasks } from "@logbook/task/list.js"
import { assignTaskModel, assignTaskPhaseModel } from "@logbook/task/model-assignment.js"
import { assignTaskSession } from "@logbook/task/session-assignment.js"
import { updateTaskStatus } from "@logbook/task/update.js"
import { hookListTool, hookRunTool } from "./hook-tools.js"
import { linearPullTool } from "./linear-pull-tool.js"
import { linearPushTool } from "./linear-push-tool.js"
import { linearSetupTool } from "./linear-setup-tool.js"
import { linearStatusTool } from "./linear-status-tool.js"
import { type ListPluginsInput, listPlugins } from "./list.js"
import { workspaceInitTool } from "./workspace-init-tool.js"
import { workspaceStatusTool } from "./workspace-status-tool.js"

const TOOL_LIMIT = 100
const DESCRIPTION_MAX_BYTES = 2048
const LOWERCASE_DOTTED_ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/
const LOGBOOK_V2_VERSION = "2.0.0"
const textEncoder = new TextEncoder()

type AnyDefinedTool = DefinedTool<any, any, any, never>

export type RegisteredPluginMetadata = {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly enabled: boolean
  readonly groups: readonly string[]
  readonly toolIds: readonly string[]
  readonly provider?: string | undefined
}

export type RegisteredLogbookTools = {
  readonly plugins: readonly OhtoolsPlugin[]
  readonly groups: readonly DefinedGroup<string>[]
  readonly metadata: readonly RegisteredPluginMetadata[]
  readonly toolIds: readonly string[]
}

type StaticPluginDefinition = {
  readonly metadata: RegisteredPluginMetadata
  readonly description: string
  readonly tools: readonly AnyDefinedTool[]
}

type RegisterLogbookToolsOptions = {
  readonly version?: string | undefined
  readonly plugins?: readonly RegisteredPluginMetadata[] | undefined
}

const staticTool = <Id extends string>(
  id: Id,
  description: string,
  run: (input: any) => unknown
): AnyDefinedTool =>
  defineTool({
    id,
    description,
    run: (input) => run(input),
  }) as unknown as AnyDefinedTool

const epicCreateTool = staticTool("epic.create", "Create an epic record.", createEpic)
const epicGetTool = staticTool("epic.get", "Load one epic by id.", getEpic)
const epicListTool = staticTool("epic.list", "List epics with current filters.", listEpics)
const epicUpdateTool = staticTool("epic.update", "Update one epic.", updateEpic)
const epicDeleteTool = staticTool("epic.delete", "Delete or tombstone one epic.", deleteEpic)

const storyCreateTool = staticTool("story.create", "Create a story within an epic.", createStory)
const storyGetTool = staticTool("story.get", "Load one story by id.", getStory)
const storyListTool = staticTool("story.list", "List stories with current filters.", listStories)
const storyUpdateTool = staticTool("story.update", "Update one story.", updateStory)
const storyDeleteTool = staticTool("story.delete", "Delete or tombstone one story.", deleteStory)

const taskCreateTool = staticTool("task.create", "Create one task record.", createTask)
const taskGetTool = staticTool("task.get", "Load one task by id.", getTask)
const taskListTool = staticTool("task.list", "List tasks with current filters.", listTasks)
const taskCurrentTool = staticTool(
  "task.current",
  "Resolve the current task for a session.",
  getCurrentTask
)
const taskUpdateTool = staticTool("task.update", "Update one task status.", updateTaskStatus)
const taskEditTool = staticTool("task.edit", "Edit one task record.", editTask)
const taskAssignSessionTool = staticTool(
  "task.assign.session",
  "Assign a session to one task.",
  assignTaskSession
)
const taskAssignModelTool = staticTool(
  "task.assign.model",
  "Assign a default model to one task.",
  assignTaskModel
)
const taskAssignPhaseModelTool = staticTool(
  "task.assign.phase-model",
  "Assign a phase-specific model to one task.",
  assignTaskPhaseModel
)
const taskEstimateTool = staticTool(
  "task.estimate",
  "Create or update a task estimate.",
  estimateTask
)

const contextCreateTool = staticTool(
  "context.create",
  "Create one context entry.",
  createContextEntry
)
const contextGetTool = staticTool("context.get", "Load one context entry by id.", getContextEntry)
const contextListTool = staticTool(
  "context.list",
  "List context entries with current filters.",
  listContextEntries
)
const contextUpdateTool = staticTool(
  "context.update",
  "Update one context entry.",
  updateContextEntry
)
const contextDeleteTool = staticTool(
  "context.delete",
  "Delete or tombstone one context entry.",
  deleteContextEntry
)
const contextAttachTool = staticTool(
  "context.attach",
  "Attach one context entry to a target.",
  attachContext
)
const contextDetachTool = staticTool(
  "context.detach",
  "Detach one context entry from a target.",
  detachContext
)
const contextSearchTool = staticTool(
  "context.search",
  "Search context entries.",
  searchContextEntries
)

let currentRegistry: RegisteredLogbookTools | undefined

const pluginListTool = staticTool(
  "plugin.list",
  "List the statically registered Logbook plugins.",
  (input: unknown): ToolResult<unknown> =>
    listPlugins(asListPluginsInput(input), currentRegistry ?? registerLogbookTools())
)

const workspaceTools = [
  workspaceInitTool as unknown as AnyDefinedTool,
  workspaceStatusTool as unknown as AnyDefinedTool,
] as const
const hookTools = [
  hookListTool as unknown as AnyDefinedTool,
  hookRunTool as unknown as AnyDefinedTool,
] as const
const syncTools = [
  linearPullTool as unknown as AnyDefinedTool,
  linearPushTool as unknown as AnyDefinedTool,
  linearSetupTool as unknown as AnyDefinedTool,
  linearStatusTool as unknown as AnyDefinedTool,
  listSyncConflictsTool as unknown as AnyDefinedTool,
  resolveSyncConflictTool as unknown as AnyDefinedTool,
] as const

const defaultPluginDefinitions: readonly StaticPluginDefinition[] = [
  createPluginDefinition("context", "Context tools.", [
    contextAttachTool,
    contextCreateTool,
    contextDeleteTool,
    contextDetachTool,
    contextGetTool,
    contextListTool,
    contextSearchTool,
    contextUpdateTool,
  ]),
  createPluginDefinition("epic", "Epic tools.", [
    epicCreateTool,
    epicDeleteTool,
    epicGetTool,
    epicListTool,
    epicUpdateTool,
  ]),
  createPluginDefinition("hook", "Hook tools.", hookTools),
  createPluginDefinition("plugin", "Plugin registry tools.", [pluginListTool]),
  createPluginDefinition("story", "Story tools.", [
    storyCreateTool,
    storyDeleteTool,
    storyGetTool,
    storyListTool,
    storyUpdateTool,
  ]),
  createPluginDefinition("task", "Task tools.", [
    taskAssignModelTool,
    taskAssignPhaseModelTool,
    taskAssignSessionTool,
    taskCreateTool,
    taskCurrentTool,
    taskEditTool,
    taskEstimateTool,
    taskGetTool,
    taskListTool,
    taskUpdateTool,
  ]),
  createPluginDefinition("sync", "Sync tools.", syncTools),
  createPluginDefinition("workspace", "Workspace tools.", workspaceTools),
]

export const registerLogbookTools = (
  options: RegisterLogbookToolsOptions = {}
): RegisteredLogbookTools => {
  const definitions =
    options.plugins === undefined
      ? defaultPluginDefinitions.map((definition) =>
          options.version === undefined
            ? definition
            : {
                ...definition,
                metadata: {
                  ...definition.metadata,
                  version: options.version,
                },
              }
        )
      : options.plugins.map((metadata) => createSyntheticPluginDefinition(metadata))

  const registered = buildRegistry(definitions)
  if (options.plugins === undefined) {
    currentRegistry = registered
  }

  return registered
}

function createPluginDefinition(
  id: string,
  description: string,
  tools: readonly AnyDefinedTool[]
): StaticPluginDefinition {
  return {
    metadata: {
      id,
      name: id,
      version: LOGBOOK_V2_VERSION,
      enabled: true,
      groups: Object.freeze([id]),
      toolIds: Object.freeze(
        tools.map((tool) => tool.id).sort((left, right) => left.localeCompare(right))
      ),
    },
    description,
    tools,
  }
}

function createSyntheticPluginDefinition(
  metadata: RegisteredPluginMetadata
): StaticPluginDefinition {
  return {
    metadata: normalizeMetadata(metadata),
    description: `${metadata.name} tools.`,
    tools: metadata.toolIds.map((toolId) =>
      staticTool(toolId, `Static tool ${toolId}.`, () => ({ ok: true, data: {} }))
    ),
  }
}

function normalizeMetadata(metadata: RegisteredPluginMetadata): RegisteredPluginMetadata {
  return {
    id: metadata.id,
    name: metadata.name,
    version: metadata.version,
    enabled: metadata.enabled,
    groups: Object.freeze([...metadata.groups].sort((left, right) => left.localeCompare(right))),
    toolIds: Object.freeze([...metadata.toolIds].sort((left, right) => left.localeCompare(right))),
    ...(metadata.provider === undefined ? {} : { provider: metadata.provider }),
  }
}

const buildRegistry = (definitions: readonly StaticPluginDefinition[]): RegisteredLogbookTools => {
  validateRegistry(definitions)

  const normalizedDefinitions = [...definitions].sort((left, right) =>
    left.metadata.id.localeCompare(right.metadata.id)
  )
  const groups = normalizedDefinitions.map(({ metadata, description, tools }) =>
    defineGroup({ id: metadata.id, description }, (group) => {
      let next = group
      for (const tool of tools) {
        next = next.tool(tool)
      }
      return next
    })
  )
  const plugins = normalizedDefinitions.map(({ metadata }, index) => {
    const group = groups[index] as ReturnType<typeof defineGroup>
    return plugin(metadata.id).group(group)
  })
  const metadata = Object.freeze(
    normalizedDefinitions.map(({ metadata }) => normalizeMetadata(metadata))
  )
  const toolIds = Object.freeze(
    normalizedDefinitions
      .flatMap(({ metadata }) => metadata.toolIds)
      .sort((left, right) => left.localeCompare(right))
  )

  return {
    plugins: Object.freeze(plugins),
    groups: Object.freeze(groups),
    metadata,
    toolIds,
  }
}

const collectTools = (definitions: readonly StaticPluginDefinition[]): readonly AnyDefinedTool[] =>
  definitions.flatMap((definition) => definition.tools)

const validateRegistry = (definitions: readonly StaticPluginDefinition[]): void => {
  const tools = collectTools(definitions)
  if (tools.length > TOOL_LIMIT) {
    throw toolRegistrationError(`registered tools exceed ${TOOL_LIMIT}`, {
      count: tools.length,
      maxTools: TOOL_LIMIT,
    })
  }

  const seen = new Set<string>()
  for (const tool of tools) {
    if (!LOWERCASE_DOTTED_ID.test(tool.id)) {
      throw toolRegistrationError(`tool id must use lowercase dotted hierarchy: ${tool.id}`, {
        toolId: tool.id,
      })
    }

    const descriptionBytes = textEncoder.encode(tool.description).length
    if (descriptionBytes > DESCRIPTION_MAX_BYTES) {
      throw toolRegistrationError(`tool description exceeds ${DESCRIPTION_MAX_BYTES} bytes`, {
        toolId: tool.id,
        actualBytes: descriptionBytes,
        maxBytes: DESCRIPTION_MAX_BYTES,
      })
    }

    if (seen.has(tool.id)) {
      throw toolRegistrationError(`duplicate tool id registered: ${tool.id}`, {
        toolId: tool.id,
      })
    }

    seen.add(tool.id)
  }
}

const toolRegistrationError = (message: string, details?: Record<string, unknown>): Error => {
  const error = new Error(message) as Error & {
    code?: string
    details?: Record<string, unknown>
  }
  error.code = "tool_registration_error"
  if (details !== undefined) {
    error.details = details
  }
  return error
}

const asListPluginsInput = (input: unknown): ListPluginsInput =>
  typeof input === "object" && input !== null ? (input as ListPluginsInput) : {}
