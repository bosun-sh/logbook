import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { ExternalLink } from "@logbook/context/schema.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { createSyncConflict } from "@logbook/sync/conflicts.js"
import { appendSyncEvent } from "@logbook/sync/events.js"
import { findExternalLink, upsertExternalLink } from "@logbook/sync/external-links.js"
import { type LinearIssueRecord, mapTaskToLinearIssueInput } from "@logbook/sync/linear/mapping.js"
import type { LinearGraphQLClient } from "@logbook/sync/linear/transport.js"
import type {
  SyncProviderError,
  SyncPushInput,
  SyncPushResult,
} from "@logbook/sync/provider-port.js"
import type { SyncEvent } from "@logbook/sync/schema.js"
import type { Task } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"

const LINEAR_PROVIDER_ID = "linear"
const DEFAULT_COMMENT_PAGE_SIZE = 100
const MAX_COMMENT_PAGE_SIZE = 100
const LINEAR_CREATE_ISSUE_OPERATION = "LinearCreateIssue"
const LINEAR_UPDATE_ISSUE_OPERATION = "LinearUpdateIssue"
const LINEAR_CREATE_COMMENT_OPERATION = "LinearCreateComment"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

type ExternalLinkRepositoryShape = {
  create(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
  get(id: string): Effect.Effect<ExternalLink, unknown>
  list(): Effect.Effect<readonly ExternalLink[], unknown>
  update(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
}

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

type SyncConflictRepositoryShape = {
  create(conflict: unknown): Effect.Effect<unknown, unknown>
  get(id: string): Effect.Effect<unknown, unknown>
  list(): Effect.Effect<readonly unknown[], unknown>
  update(conflict: unknown): Effect.Effect<unknown, unknown>
}

const TaskRepository = Context.GenericTag<TaskRepositoryShape>("TaskRepository")
const SyncEventRepository = Context.GenericTag<SyncEventRepositoryShape>("SyncEventRepository")
const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

type GetWorkspaceLinearConfigResult =
  | { readonly ok: true; readonly data: LinearWorkspaceConfig | undefined }
  | { readonly ok: false; readonly error: ToolError }

type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

type LinearWorkspaceConfig = {
  readonly apiTokenEnv: string
  readonly workspaceId?: string
  readonly defaultTeamId?: string
  readonly defaultProjectId?: string
  readonly statusMapping?: {
    readonly linearStateTypeToTaskStatus?: Record<string, Task["status"]>
    readonly linearStateIdToTaskStatus?: Record<string, Task["status"]>
    readonly taskStatusToLinearStateId?: Record<Task["status"], string>
  }
  readonly labelMapping?: {
    readonly labelNameToTopic?: Record<string, string>
  }
}

type LinearIssueLookupResponse = {
  readonly issue?: LinearIssueRecord | null
}

type LinearCreateIssueResponse = {
  readonly issueCreate?: {
    readonly issue?: LinearIssueRecord | null
  } | null
}

type LinearUpdateIssueResponse = {
  readonly issueUpdate?: {
    readonly issue?: LinearIssueRecord | null
  } | null
}

type LinearCreateCommentResponse = {
  readonly commentCreate?: {
    readonly comment?: {
      readonly id: string
      readonly createdAt: string
    } | null
  } | null
}

export type PushLinearSyncInput = SyncPushInput

export type PushLinearSyncResult = SyncPushResult

export const pushLinearSync = (
  input: PushLinearSyncInput
): Effect.Effect<
  ToolResult<PushLinearSyncResult>,
  never,
  | LinearGraphQLClient
  | TaskRepositoryShape
  | ExternalLinkRepositoryShape
  | SyncEventRepositoryShape
  | SyncConflictRepositoryShape
  | Clock.Clock
> =>
  Effect.gen(function* () {
    const configResult = yield* Effect.promise(() => readLinearWorkspaceConfig())
    if (!configResult.ok) {
      return configResult
    }

    const config = configResult.data
    const taskRepo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const eventRepo = (yield* SyncEventRepository) as unknown as SyncEventRepositoryShape
    const client = (yield* LinearGraphQLClientTag) as unknown as LinearGraphQLClient
    const defaultTeamId = config?.defaultTeamId
    const defaultProjectId = config?.defaultProjectId
    const statusMapping = config?.statusMapping
    const labelMapping = config?.labelMapping

    if (resolveLinearToken(config) === undefined) {
      return providerError("auth_failed", "Linear API token is required.", {
        provider: LINEAR_PROVIDER_ID,
        reason: "missing_token",
      })
    }

    const tasksResult = yield* loadTasks(taskRepo, input.taskIds)
    if (!tasksResult.ok) {
      return tasksResult
    }
    const tasks = tasksResult.data
    let created = 0
    let updated = 0
    let skipped = 0
    let conflicts = 0
    const events: SyncEvent[] = []

    for (const task of tasks) {
      const linkResult = yield* findExternalLink({
        provider: LINEAR_PROVIDER_ID,
        localRecord: { kind: "task", id: task.id },
        limit: 2,
      })
      if (!linkResult.ok) {
        return linkResult
      }

      const link = linkResult.data.externalLinks[0]
      if (link === undefined) {
        if (defaultTeamId === undefined || defaultTeamId.length === 0) {
          const event = yield* appendAndCollect(events, eventRepo, {
            direction: "push",
            data: {
              result: "skipped",
              providerId: LINEAR_PROVIDER_ID,
              entityType: "task",
              entityId: task.id,
              reason: "missing_mapping",
            },
          })
          if (!event.ok) {
            return event
          }
          skipped += 1
          continue
        }

        if (input.dryRun) {
          const event = yield* appendAndCollect(events, eventRepo, {
            direction: "push",
            data: {
              result: "skipped",
              providerId: LINEAR_PROVIDER_ID,
              entityType: "task",
              entityId: task.id,
              reason: "dry_run",
            },
          })
          if (!event.ok) {
            return event
          }
          skipped += 1
          continue
        }

        const createProjectId = input.projectId ?? defaultProjectId
        const mapped = mapTaskToLinearIssueInput(task, {
          ...(defaultTeamId === undefined ? {} : { defaultTeamId }),
          ...(createProjectId === undefined ? {} : { defaultProjectId: createProjectId }),
          ...(statusMapping === undefined ? {} : { statusMapping }),
          ...(labelMapping === undefined ? {} : { labelMapping }),
        })
        if (!mapped.ok) {
          return mapped
        }

        const createdIssue = yield* Effect.either(
          client.request<LinearCreateIssueResponse>({
            operationName: LINEAR_CREATE_ISSUE_OPERATION,
            query: LINEAR_CREATE_ISSUE_QUERY,
            variables: mapped.data.input,
          })
        )
        if (createdIssue._tag === "Left") {
          const failure = yield* appendFailedEvent(events, eventRepo, {
            entityType: "task",
            entityId: task.id,
            error: createdIssue.left,
          })
          if (!failure.ok) {
            return failure
          }
          return providerError("unknown", "Linear issue creation failed.", {
            provider: LINEAR_PROVIDER_ID,
            error: createdIssue.left,
          })
        }

        const createdRecord = createdIssue.right.issueCreate?.issue
        if (createdRecord === undefined || createdRecord === null) {
          const failure = yield* appendFailedEvent(events, eventRepo, {
            entityType: "task",
            entityId: task.id,
            error: {
              providerId: LINEAR_PROVIDER_ID,
              code: "not_found",
              retryable: false,
              message: "Linear issue creation returned no issue.",
            },
          })
          if (!failure.ok) {
            return failure
          }
          return providerError("unknown", "Linear issue creation returned no issue.", {
            provider: LINEAR_PROVIDER_ID,
          })
        }

        const commentResult = yield* pushTaskComments({
          task,
          issueId: createdRecord.id,
          lastPushedLocalVersion: undefined,
          client,
          events,
          eventRepo,
        })
        if (!commentResult.ok) {
          return commentResult
        }

        const now = yield* nowIso()
        const linked = yield* upsertExternalLink({
          provider: LINEAR_PROVIDER_ID,
          localRecord: { kind: "task", id: task.id },
          remoteRecord: {
            id: createdRecord.id,
            ...(createdRecord.url === undefined || createdRecord.url === null
              ? {}
              : { url: createdRecord.url }),
            type: "issue",
          },
          lastSyncedAt: now,
          lastSeenRemoteVersion: createdRecord.updatedAt,
          lastPushedLocalVersion: task.updatedAt,
        })
        if (!linked.ok) {
          return linked
        }

        const event = yield* appendAndCollect(events, eventRepo, {
          direction: "push",
          data: {
            result: "created",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: task.id,
            remoteId: createdRecord.id,
            fields:
              commentResult.data.pushedComments > 0
                ? ["title", "description", "status", "priority", "comments"]
                : ["title", "description", "status", "priority"],
          },
        })
        if (!event.ok) {
          return event
        }
        created += 1
        continue
      }

      const issueResult = yield* Effect.either(
        client.request<LinearIssueLookupResponse>({
          operationName: "LinearGetIssue",
          query: LINEAR_GET_ISSUE_QUERY,
          variables: {
            id: link.remoteRecord.id,
          },
        })
      )
      if (issueResult._tag === "Left") {
        const failure = yield* appendFailedEvent(events, eventRepo, {
          entityType: "task",
          entityId: task.id,
          remoteId: link.remoteRecord.id,
          error: issueResult.left,
        })
        if (!failure.ok) {
          return failure
        }
        return providerError("unknown", "Linear issue lookup failed.", {
          provider: LINEAR_PROVIDER_ID,
          error: issueResult.left,
        })
      }

      const remoteIssue = issueResult.right.issue
      if (remoteIssue === undefined || remoteIssue === null) {
        const failure = yield* appendFailedEvent(events, eventRepo, {
          entityType: "task",
          entityId: task.id,
          remoteId: link.remoteRecord.id,
          error: {
            providerId: LINEAR_PROVIDER_ID,
            code: "not_found",
            retryable: false,
            message: "Linear issue was not found.",
          },
        })
        if (!failure.ok) {
          return failure
        }
        return providerError("not_found", "Linear issue was not found.", {
          provider: LINEAR_PROVIDER_ID,
          remoteId: link.remoteRecord.id,
        })
      }

      const localChanged = link.lastPushedLocalVersion !== task.updatedAt
      const remoteChanged = link.lastSeenRemoteVersion !== remoteIssue.updatedAt
      if (localChanged && remoteChanged) {
        const conflict = yield* createSyncConflict({
          provider: LINEAR_PROVIDER_ID,
          localRecord: { kind: "task", id: task.id },
          remoteRecord: {
            id: remoteIssue.id,
            ...(remoteIssue.url === undefined || remoteIssue.url === null
              ? {}
              : { url: remoteIssue.url }),
          },
          fields: pushConflictFields(task, remoteIssue),
        })
        if (!conflict.ok) {
          return conflict
        }

        if (conflict.data.conflict !== undefined) {
          const event = yield* appendAndCollect(events, eventRepo, {
            direction: "push",
            data: {
              result: "conflict",
              providerId: LINEAR_PROVIDER_ID,
              conflictId: conflict.data.conflict.id,
              entityType: "task",
              entityId: task.id,
              fields: [...conflict.data.decision.fields],
            },
          })
          if (!event.ok) {
            return event
          }
          conflicts += 1
        }
        continue
      }

      if (!localChanged) {
        const event = yield* appendAndCollect(events, eventRepo, {
          direction: "push",
          data: {
            result: "skipped",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: task.id,
            remoteId: remoteIssue.id,
            reason: "unchanged",
          },
        })
        if (!event.ok) {
          return event
        }
        skipped += 1
        continue
      }

      if (input.dryRun) {
        const event = yield* appendAndCollect(events, eventRepo, {
          direction: "push",
          data: {
            result: "skipped",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: task.id,
            remoteId: remoteIssue.id,
            reason: "dry_run",
          },
        })
        if (!event.ok) {
          return event
        }
        skipped += 1
        continue
      }

      const updateTeamId = remoteIssue.team?.id ?? defaultTeamId
      const updateProjectId = input.projectId ?? defaultProjectId ?? remoteIssue.project?.id
      const mapped = mapTaskToLinearIssueInput(task, {
        ...(updateTeamId === undefined ? {} : { defaultTeamId: updateTeamId }),
        ...(updateProjectId === undefined ? {} : { defaultProjectId: updateProjectId }),
        ...(statusMapping === undefined ? {} : { statusMapping }),
        ...(labelMapping === undefined ? {} : { labelMapping }),
      })
      if (!mapped.ok) {
        return mapped
      }

      const updateInput = {
        input: {
          id: remoteIssue.id,
          title: mapped.data.input.title,
          description: mapped.data.input.description,
          teamId: remoteIssue.team?.id ?? mapped.data.input.teamId,
          ...(mapped.data.input.projectId === undefined
            ? {}
            : { projectId: mapped.data.input.projectId }),
          ...(mapped.data.input.stateId === undefined
            ? {}
            : { stateId: mapped.data.input.stateId }),
          priority: mapped.data.input.priority,
        },
      }

      const issueUpdateResult = yield* Effect.either(
        client.request<LinearUpdateIssueResponse>({
          operationName: LINEAR_UPDATE_ISSUE_OPERATION,
          query: LINEAR_UPDATE_ISSUE_QUERY,
          variables: updateInput,
        })
      )
      if (issueUpdateResult._tag === "Left") {
        const failure = yield* appendFailedEvent(events, eventRepo, {
          entityType: "task",
          entityId: task.id,
          remoteId: remoteIssue.id,
          error: issueUpdateResult.left,
        })
        if (!failure.ok) {
          return failure
        }
        return providerError("unknown", "Linear issue update failed.", {
          provider: LINEAR_PROVIDER_ID,
          error: issueUpdateResult.left,
        })
      }

      const updatedRecord = issueUpdateResult.right.issueUpdate?.issue
      if (updatedRecord === undefined || updatedRecord === null) {
        const failure = yield* appendFailedEvent(events, eventRepo, {
          entityType: "task",
          entityId: task.id,
          remoteId: remoteIssue.id,
          error: {
            providerId: LINEAR_PROVIDER_ID,
            code: "not_found",
            retryable: false,
            message: "Linear issue update returned no issue.",
          },
        })
        if (!failure.ok) {
          return failure
        }
        return providerError("unknown", "Linear issue update returned no issue.", {
          provider: LINEAR_PROVIDER_ID,
        })
      }

      const commentResult = yield* pushTaskComments({
        task,
        issueId: updatedRecord.id,
        lastPushedLocalVersion: link.lastPushedLocalVersion,
        client,
        events,
        eventRepo,
      })
      if (!commentResult.ok) {
        return commentResult
      }

      const now = yield* nowIso()
      const linked = yield* upsertExternalLink({
        provider: LINEAR_PROVIDER_ID,
        localRecord: { kind: "task", id: task.id },
        remoteRecord: {
          id: updatedRecord.id,
          ...(updatedRecord.url === undefined || updatedRecord.url === null
            ? {}
            : { url: updatedRecord.url }),
          type: "issue",
        },
        lastSyncedAt: now,
        lastSeenRemoteVersion: updatedRecord.updatedAt,
        lastPushedLocalVersion: task.updatedAt,
      })
      if (!linked.ok) {
        return linked
      }

      const fields = ["title", "description", "status", "priority"]
      const event = yield* appendAndCollect(events, eventRepo, {
        direction: "push",
        data: {
          result: "updated",
          providerId: LINEAR_PROVIDER_ID,
          entityType: "task",
          entityId: task.id,
          remoteId: updatedRecord.id,
          fields: commentResult.data.pushedComments > 0 ? [...fields, "comments"] : fields,
        },
      })
      if (!event.ok) {
        return event
      }
      updated += 1
    }

    return {
      ok: true,
      data: {
        created,
        updated,
        skipped,
        conflicts,
        events,
      },
    }
  })

const loadTasks = (
  taskRepo: TaskRepositoryShape,
  taskIds: readonly string[] | undefined
): Effect.Effect<ToolResult<readonly Task[]>, never> =>
  Effect.gen(function* () {
    if (taskIds === undefined || taskIds.length === 0) {
      const tasks = yield* Effect.either(taskRepo.findByStatus("*"))
      if (tasks._tag === "Left") {
        return repositoryError(tasks.left)
      }
      return { ok: true, data: tasks.right }
    }

    const tasks: Task[] = []
    for (const taskId of taskIds) {
      const task = yield* Effect.either(taskRepo.findById(taskId))
      if (task._tag === "Left") {
        return repositoryError(task.left)
      }
      tasks.push(task.right)
    }

    return { ok: true, data: tasks }
  })

type CommentPushResult = {
  readonly pushedComments: number
}

const pushTaskComments = (input: {
  readonly task: Task
  readonly issueId: string
  readonly lastPushedLocalVersion?: string | undefined
  readonly client: LinearGraphQLClient
  readonly events: SyncEvent[]
  readonly eventRepo: SyncEventRepositoryShape
}): Effect.Effect<ToolResult<CommentPushResult>, never, Clock.Clock | SyncEventRepositoryShape> =>
  Effect.gen(function* () {
    const comments = input.task.comments
      .filter((comment) => comment.kind !== "sync")
      .filter((comment) =>
        input.lastPushedLocalVersion === undefined
          ? true
          : comment.createdAt > input.lastPushedLocalVersion
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )

    if (comments.length === 0) {
      return {
        ok: true,
        data: { pushedComments: 0 },
      }
    }

    const page = comments.slice(0, MAX_COMMENT_PAGE_SIZE)
    if (comments.length > MAX_COMMENT_PAGE_SIZE) {
      const event = yield* appendAndCollect(input.events, input.eventRepo, {
        direction: "push",
        data: {
          result: "skipped",
          providerId: LINEAR_PROVIDER_ID,
          entityType: "task",
          entityId: input.task.id,
          remoteId: input.issueId,
          reason: "filtered",
        },
      })
      if (!event.ok) {
        return event
      }
    }

    for (const comment of page) {
      const created = yield* Effect.either(
        input.client.request<LinearCreateCommentResponse>({
          operationName: LINEAR_CREATE_COMMENT_OPERATION,
          query: LINEAR_CREATE_COMMENT_QUERY,
          variables: {
            issueId: input.issueId,
            body: comment.content,
          },
        })
      )
      if (created._tag === "Left") {
        return providerError("unknown", "Linear comment creation failed.", {
          provider: LINEAR_PROVIDER_ID,
          error: created.left,
        })
      }

      if (
        created.right.commentCreate?.comment === undefined ||
        created.right.commentCreate.comment === null
      ) {
        return providerError("unknown", "Linear comment creation returned no comment.", {
          provider: LINEAR_PROVIDER_ID,
        })
      }
    }

    if (comments.length > MAX_COMMENT_PAGE_SIZE) {
      return {
        ok: true,
        data: {
          pushedComments: page.length,
        },
        warnings: [
          {
            code: "has_more",
            message: "Linear comments exceeded the 100 item limit.",
            details: {
              providerId: LINEAR_PROVIDER_ID,
              issueId: input.issueId,
              hasMore: true,
              limit: MAX_COMMENT_PAGE_SIZE,
              cursor: {
                providerId: LINEAR_PROVIDER_ID,
                cursor: page[page.length - 1]?.id,
                pageSize: DEFAULT_COMMENT_PAGE_SIZE,
              },
            },
          },
        ],
      }
    }

    return {
      ok: true,
      data: {
        pushedComments: page.length,
      },
    }
  })

const appendAndCollect = (
  events: SyncEvent[],
  eventRepo: SyncEventRepositoryShape,
  input: Parameters<typeof appendSyncEvent>[0]
): Effect.Effect<ToolResult<undefined>, never, Clock.Clock | SyncEventRepositoryShape> =>
  Effect.gen(function* () {
    const result = yield* appendSyncEvent(input)
    if (!result.ok) {
      return result
    }
    events.push(result.data.syncEvent)
    const saved = yield* Effect.either(eventRepo.create(result.data.syncEvent))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }
    return {
      ok: true,
      data: undefined,
    }
  })

const appendFailedEvent = (
  events: SyncEvent[],
  eventRepo: SyncEventRepositoryShape,
  input: {
    readonly entityType?: string | undefined
    readonly entityId?: string | undefined
    readonly remoteId?: string | undefined
    readonly error: unknown
  }
): Effect.Effect<ToolResult<undefined>, never, Clock.Clock | SyncEventRepositoryShape> =>
  appendAndCollect(events, eventRepo, {
    direction: "push",
    data: {
      result: "failed",
      providerId: LINEAR_PROVIDER_ID,
      ...(input.entityType === undefined ? {} : { entityType: input.entityType }),
      ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
      ...(input.remoteId === undefined ? {} : { remoteId: input.remoteId }),
      error: normalizeProviderError(input.error),
    },
  })

const normalizeProviderError = (error: unknown): SyncProviderError =>
  isProviderError(error)
    ? error
    : ({
        providerId: LINEAR_PROVIDER_ID,
        code: "unknown",
        retryable: false,
        message: "Linear provider request failed.",
        details: { error: String(error) },
      } as SyncProviderError)

const isProviderError = (value: unknown): value is SyncProviderError =>
  isRecord(value) &&
  typeof value.providerId === "string" &&
  typeof value.code === "string" &&
  typeof value.retryable === "boolean" &&
  typeof value.message === "string"

const resolveLinearToken = (config: LinearWorkspaceConfig | undefined): string | undefined => {
  const envName = config?.apiTokenEnv ?? "LINEAR_API_KEY"
  const value = process.env[envName]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

const readLinearWorkspaceConfig = async (): Promise<GetWorkspaceLinearConfigResult> => {
  const path = resolve(process.cwd(), ".logbook/config.json")
  try {
    const content = await readFile(path, "utf8")
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed) || parsed.schemaVersion !== "2") {
      return { ok: true, data: undefined }
    }
    if (!isRecord(parsed.linear)) {
      return { ok: true, data: undefined }
    }

    const linear = parsed.linear
    return {
      ok: true,
      data: {
        apiTokenEnv:
          typeof linear.apiTokenEnv === "string" && linear.apiTokenEnv.length > 0
            ? linear.apiTokenEnv
            : "LINEAR_API_KEY",
        ...(typeof linear.workspaceId === "string" && linear.workspaceId.length > 0
          ? { workspaceId: linear.workspaceId }
          : {}),
        ...(typeof linear.defaultTeamId === "string" && linear.defaultTeamId.length > 0
          ? { defaultTeamId: linear.defaultTeamId }
          : {}),
        ...(typeof linear.defaultProjectId === "string" && linear.defaultProjectId.length > 0
          ? { defaultProjectId: linear.defaultProjectId }
          : {}),
        ...(isRecord(linear.statusMapping)
          ? {
              statusMapping: {
                ...(isRecord(linear.statusMapping.linearStateTypeToTaskStatus)
                  ? {
                      linearStateTypeToTaskStatus: linear.statusMapping
                        .linearStateTypeToTaskStatus as Record<string, Task["status"]>,
                    }
                  : {}),
                ...(isRecord(linear.statusMapping.linearStateIdToTaskStatus)
                  ? {
                      linearStateIdToTaskStatus: linear.statusMapping
                        .linearStateIdToTaskStatus as Record<string, Task["status"]>,
                    }
                  : {}),
                ...(isRecord(linear.statusMapping.taskStatusToLinearStateId)
                  ? {
                      taskStatusToLinearStateId: linear.statusMapping
                        .taskStatusToLinearStateId as Record<Task["status"], string>,
                    }
                  : {}),
              },
            }
          : {}),
        ...(isRecord(linear.labelMapping) && isRecord(linear.labelMapping.labelNameToTopic)
          ? {
              labelMapping: {
                labelNameToTopic: linear.labelMapping.labelNameToTopic as Record<string, string>,
              },
            }
          : {}),
      },
    }
  } catch (cause) {
    if (isEnoent(cause)) {
      return { ok: true, data: undefined }
    }

    return {
      ok: false,
      error: workspaceError("Failed to read Linear workspace config.", { cause: String(cause) }),
    }
  }
}

const isEnoent = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const repositoryError = (cause: unknown): ToolResult<never> => ({
  ok: false,
  error: {
    code: "storage_error",
    message: "Repository operation failed.",
    ...(cause === undefined ? {} : { details: { cause } }),
  },
})

const providerError = (
  code: ToolError["code"],
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  } as ToolError,
})

const workspaceError = (message: string, details?: Record<string, unknown>): ToolError => ({
  code: "workspace_error",
  message,
  ...(details === undefined ? {} : { details }),
})

const pushConflictFields = (task: Task, issue: LinearIssueRecord) =>
  (
    [
      ["title", task.title, issue.title],
      ["description", task.description, issue.description ?? ""],
      ["status", task.status, mapLinearStateToTaskStatus(issue)],
      ["priority", task.priority, issue.priority ?? 0],
    ] as const
  ).map(([path, localValue, remoteValue]) => ({
    path,
    localValue,
    remoteValue,
  }))

const mapLinearStateToTaskStatus = (issue: LinearIssueRecord): Task["status"] => {
  switch (issue.state?.type ?? "unstarted") {
    case "backlog":
      return "backlog"
    case "unstarted":
      return "todo"
    case "started":
      return "in_progress"
    case "completed":
      return "done"
    case "canceled":
      return "canceled"
    default:
      return "todo"
  }
}

const LINEAR_CREATE_ISSUE_QUERY = `
mutation LinearCreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    issue {
      id
      identifier
      url
      title
      description
      priority
      updatedAt
      archivedAt
      team { id key name }
      project { id name }
      state { id name type }
      assignee { id name }
      labels { nodes { id name } }
    }
  }
}
`

const LINEAR_UPDATE_ISSUE_QUERY = `
mutation LinearUpdateIssue($input: IssueUpdateInput!) {
  issueUpdate(input: $input) {
    issue {
      id
      identifier
      url
      title
      description
      priority
      updatedAt
      archivedAt
      team { id key name }
      project { id name }
      state { id name type }
      assignee { id name }
      labels { nodes { id name } }
    }
  }
}
`

const LINEAR_CREATE_COMMENT_QUERY = `
mutation LinearCreateComment($issueId: String!, $body: String!) {
  commentCreate(issueId: $issueId, body: $body) {
    comment {
      id
      createdAt
    }
  }
}
`

const LINEAR_GET_ISSUE_QUERY = `
query LinearGetIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    url
    title
    description
    priority
    updatedAt
    archivedAt
    team { id key name }
    project { id name }
    state { id name type }
    assignee { id name }
    labels { nodes { id name } }
  }
}
`
