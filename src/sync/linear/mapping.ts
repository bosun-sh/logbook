import type { ToolResult } from "@logbook/shared/result.js"
import type { Comment } from "@logbook/shared/schema/value-objects.js"
import type { Task } from "@logbook/task/schema.js"

const CONFIG_MAX_BYTES = 65_536
const textEncoder = new TextEncoder()

type TaskStatus = Task["status"]

type LinearStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled" | string

export type LinearIssueRecord = {
  readonly id: string
  readonly identifier: string
  readonly url?: string | null
  readonly title: string
  readonly description?: string | null
  readonly priority?: number | null
  readonly updatedAt: string
  readonly archivedAt?: string | null
  readonly team?: {
    readonly id: string
    readonly key?: string | null
    readonly name?: string | null
  } | null
  readonly project?: {
    readonly id: string
    readonly name?: string | null
  } | null
  readonly state?: {
    readonly id: string
    readonly name?: string | null
    readonly type?: LinearStateType | null
  } | null
  readonly assignee?: {
    readonly id: string
    readonly name?: string | null
  } | null
  readonly labels?: {
    readonly nodes?: readonly {
      readonly id: string
      readonly name: string
    }[]
  } | null
}

type LinearCommentRecord = {
  readonly id: string
  readonly body: string
  readonly createdAt: string
  readonly user?: {
    readonly id: string
    readonly name?: string | null
  } | null
}

type LinearMappingConfig = {
  readonly defaultTeamId?: string
  readonly defaultProjectId?: string
  readonly statusMapping?: {
    readonly linearStateTypeToTaskStatus?: Partial<Record<string, TaskStatus>>
    readonly linearStateIdToTaskStatus?: Partial<Record<string, TaskStatus>>
    readonly taskStatusToLinearStateId?: Partial<Record<TaskStatus, string>>
  }
  readonly labelMapping?: {
    readonly labelNameToTopic?: Record<string, string>
  }
}

type LinearIssueTaskMapping = {
  readonly taskFields: {
    readonly title: string
    readonly description: string
    readonly definitionOfDone: string
    readonly project: string
    readonly milestone: string
    readonly status: TaskStatus
    readonly priority: number
    readonly assignee?: {
      readonly id: string
      readonly title: string
    }
  }
  readonly contextTopics: readonly string[]
  readonly providerMetadata: {
    readonly provider: "linear"
    readonly issueId: string
    readonly identifier: string
    readonly url?: string
    readonly teamId?: string
    readonly teamKey?: string
    readonly projectId?: string
    readonly stateId?: string
    readonly labelIds: readonly string[]
  }
  readonly remoteRecord: {
    readonly id: string
    readonly url?: string
    readonly type: "issue"
  }
  readonly lastSeenRemoteVersion: string
  readonly tombstone: {
    readonly archived: boolean
    readonly archivedAt?: string
    readonly decision?: "preserve_local_identity"
  }
}

type LinearIssueInput = {
  readonly input: {
    readonly title: string
    readonly description: string
    readonly teamId: string
    readonly projectId?: string
    readonly stateId?: string
    readonly priority: number
  }
}

export const mapLinearIssueToTask = (
  issue: LinearIssueRecord,
  config: LinearMappingConfig = {}
): ToolResult<LinearIssueTaskMapping> => {
  const configValidation = validateConfig(config)
  if (!configValidation.ok) {
    return configValidation
  }

  const status = mapLinearStatus(issue, config)
  if (!status.ok) {
    return status
  }

  const labels = issue.labels?.nodes ?? []
  const contextTopics = labels.map(
    (label) => config.labelMapping?.labelNameToTopic?.[label.name] ?? label.name
  )
  const assignee =
    issue.assignee === null || issue.assignee === undefined
      ? undefined
      : {
          id: `linear:${issue.assignee.id}`,
          title: issue.assignee.name ?? issue.assignee.id,
        }
  const archived = issue.archivedAt !== null && issue.archivedAt !== undefined
  const url = issue.url === null || issue.url === undefined ? undefined : issue.url

  return {
    ok: true,
    data: {
      taskFields: {
        title: issue.title,
        description: issue.description ?? "",
        definitionOfDone: `Synced Linear issue ${issue.identifier} is complete.`,
        project: issue.project?.name ?? issue.team?.name ?? "Linear",
        milestone: issue.team?.key ?? issue.team?.name ?? "Linear",
        status: status.data,
        priority: issue.priority ?? 0,
        ...(assignee === undefined ? {} : { assignee }),
      },
      contextTopics,
      providerMetadata: {
        provider: "linear",
        issueId: issue.id,
        identifier: issue.identifier,
        ...(url === undefined ? {} : { url }),
        ...(issue.team?.id === undefined ? {} : { teamId: issue.team.id }),
        ...(issue.team?.key === null || issue.team?.key === undefined
          ? {}
          : { teamKey: issue.team.key }),
        ...(issue.project?.id === undefined ? {} : { projectId: issue.project.id }),
        ...(issue.state?.id === undefined ? {} : { stateId: issue.state.id }),
        labelIds: labels.map((label) => label.id),
      },
      remoteRecord: {
        id: issue.id,
        ...(url === undefined ? {} : { url }),
        type: "issue",
      },
      lastSeenRemoteVersion: issue.updatedAt,
      tombstone: archived
        ? {
            archived,
            archivedAt: issue.archivedAt ?? undefined,
            decision: "preserve_local_identity",
          }
        : {
            archived,
          },
    },
  }
}

export const mapTaskToLinearIssueInput = (
  task: Task,
  config: LinearMappingConfig = {}
): ToolResult<LinearIssueInput> => {
  const configValidation = validateConfig(config)
  if (!configValidation.ok) {
    return configValidation
  }

  if (config.defaultTeamId === undefined || config.defaultTeamId.length === 0) {
    return validationError("linear.defaultTeamId is required before creating Linear issues.")
  }

  const stateId = config.statusMapping?.taskStatusToLinearStateId?.[task.status]
  return {
    ok: true,
    data: {
      input: {
        title: task.title,
        description: task.description,
        teamId: config.defaultTeamId,
        ...(config.defaultProjectId === undefined ? {} : { projectId: config.defaultProjectId }),
        ...(stateId === undefined ? {} : { stateId }),
        priority: task.priority,
      },
    },
  }
}

export const mapLinearComment = (
  comment: LinearCommentRecord
): ToolResult<{ readonly comment: Comment }> => ({
  ok: true,
  data: {
    comment: {
      id: `linear_${comment.id}`,
      title: "Linear comment",
      content: comment.body,
      kind: "sync",
      createdAt: comment.createdAt,
      ...(comment.user === null || comment.user === undefined
        ? {}
        : {
            author: {
              id: `linear:${comment.user.id}`,
              title: comment.user.name ?? comment.user.id,
            },
          }),
      replies: [],
    },
  },
})

const mapLinearStatus = (
  issue: LinearIssueRecord,
  config: LinearMappingConfig
): ToolResult<TaskStatus> => {
  const stateId = issue.state?.id
  if (stateId !== undefined) {
    const configuredStatus = config.statusMapping?.linearStateIdToTaskStatus?.[stateId]
    if (configuredStatus !== undefined) {
      return { ok: true, data: configuredStatus }
    }
  }

  const stateType = issue.state?.type ?? "unstarted"
  const configuredStatus = config.statusMapping?.linearStateTypeToTaskStatus?.[stateType]
  if (configuredStatus !== undefined) {
    return { ok: true, data: configuredStatus }
  }

  switch (stateType) {
    case "backlog":
      return { ok: true, data: "backlog" }
    case "unstarted":
      return { ok: true, data: "todo" }
    case "started":
      return { ok: true, data: "in_progress" }
    case "completed":
      return { ok: true, data: "done" }
    case "canceled":
      return { ok: true, data: "canceled" }
    default:
      return validationError(`Unsupported Linear workflow state type: ${stateType}`)
  }
}

const validateConfig = (config: LinearMappingConfig): ToolResult<undefined> => {
  const serialized = JSON.stringify(config)
  if (serialized !== undefined && textEncoder.encode(serialized).length > CONFIG_MAX_BYTES) {
    return validationError("Linear provider config exceeds 65536 bytes.", {
      maxBytes: CONFIG_MAX_BYTES,
    })
  }

  return {
    ok: true,
    data: undefined,
  }
}

const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})
