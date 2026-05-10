import type { ExternalLink } from "@logbook/context/schema.js"
import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { createSyncConflict } from "@logbook/sync/conflicts.js"
import { appendSyncEvent } from "@logbook/sync/events.js"
import { findExternalLink, upsertExternalLink } from "@logbook/sync/external-links.js"
import { type LinearIssueRecord, mapLinearIssueToTask } from "@logbook/sync/linear/mapping.js"
import type { LinearGraphQLClient } from "@logbook/sync/linear/transport.js"
import type { SyncCursor, SyncPullInput, SyncPullResult } from "@logbook/sync/provider-port.js"
import type { SyncEvent } from "@logbook/sync/schema.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"

const LINEAR_PROVIDER_ID = "linear"
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 50

type LinearPullInput = SyncPullInput

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const TaskRepository = Context.GenericTag<TaskRepositoryShape>("TaskRepository")

type LinearIssuesResponse = {
  readonly issues?: {
    readonly nodes?: readonly LinearIssueRecord[]
    readonly pageInfo?: {
      readonly hasNextPage?: boolean
      readonly endCursor?: string | null
    }
  }
}

const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

export const pullLinearSync = (
  input: LinearPullInput
): Effect.Effect<
  ToolResult<SyncPullResult>,
  never,
  | LinearGraphQLClient
  | TaskRepositoryShape
  | ExternalLinkRepositoryShape
  | SyncEventRepositoryShape
  | SyncConflictRepositoryShape
  | Clock.Clock
> =>
  Effect.gen(function* () {
    const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const client = (yield* LinearGraphQLClientTag) as unknown as LinearGraphQLClient
    const response = yield* Effect.either(
      client.request<LinearIssuesResponse>({
        operationName: "LinearPullIssues",
        query: LINEAR_PULL_ISSUES_QUERY,
        variables: {
          first: limit,
          ...(input.since === undefined ? {} : { since: input.since }),
          ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.cursor === undefined ? {} : { after: input.cursor.cursor }),
        },
      })
    )
    if (response._tag === "Left") {
      return providerFailure(response.left)
    }

    const issues = response.right.issues?.nodes ?? []
    const taskRepo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    let imported = 0
    let updated = 0
    let skipped = 0
    let conflicts = 0
    const events: SyncEvent[] = []

    for (const issue of issues) {
      const mapped = mapLinearIssueToTask(issue)
      if (!mapped.ok) {
        const event = yield* appendAndCollect(events, {
          direction: "pull",
          data: {
            result: "failed",
            providerId: LINEAR_PROVIDER_ID,
            remoteId: issue.id,
            error: {
              providerId: LINEAR_PROVIDER_ID,
              code: "validation_failed",
              retryable: false,
              message: mapped.error.message,
              details: mapped.error.details,
            },
          },
        })
        if (!event.ok) {
          return event
        }
        skipped += 1
        continue
      }

      const existingLink = yield* findLinkByRemoteId(issue.id)
      if (!existingLink.ok) {
        return existingLink
      }

      if (existingLink.data === undefined) {
        if (input.dryRun) {
          const event = yield* appendAndCollect(events, {
            direction: "pull",
            data: {
              result: "skipped",
              providerId: LINEAR_PROVIDER_ID,
              entityType: "task",
              remoteId: issue.id,
              reason: "dry_run",
            },
          })
          if (!event.ok) {
            return event
          }
          skipped += 1
          continue
        }

        const now = yield* nowIso()
        const task = parseTask({
          id: createId("task"),
          schemaVersion: "2" as const,
          kind: "task" as const,
          createdAt: now,
          updatedAt: now,
          ...mapped.data.taskFields,
          phaseModelOverrides: {},
          estimate: {
            predictedKTokens: 1,
            complexity: "small",
            fibonacci: 1,
            confidence: "low",
          },
          contextEntryIds: [],
          comments: [],
          externalLinks: [],
          ...(mapped.data.tombstone.archivedAt === undefined
            ? {}
            : { deletedAt: mapped.data.tombstone.archivedAt }),
        })
        if (!task.ok) {
          return task
        }

        const saved = yield* Effect.either(taskRepo.save(task.data))
        if (saved._tag === "Left") {
          return repositoryError(saved.left)
        }

        const linked = yield* upsertExternalLink({
          provider: LINEAR_PROVIDER_ID,
          localRecord: { kind: "task", id: task.data.id },
          remoteRecord: mapped.data.remoteRecord,
          lastSeenRemoteVersion: mapped.data.lastSeenRemoteVersion,
          lastPushedLocalVersion: task.data.updatedAt,
        })
        if (!linked.ok) {
          return linked
        }

        const event = yield* appendAndCollect(events, {
          direction: "pull",
          data: {
            result: "created",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: task.data.id,
            remoteId: issue.id,
            fields: ["title", "description", "status", "priority"],
          },
        })
        if (!event.ok) {
          return event
        }
        imported += 1
        continue
      }

      const existingTask = yield* Effect.either(taskRepo.findById(existingLink.data.localRecord.id))
      if (existingTask._tag === "Left") {
        return repositoryError(existingTask.left)
      }

      const remoteChanged =
        existingLink.data.lastSeenRemoteVersion !== mapped.data.lastSeenRemoteVersion
      const localChanged = existingLink.data.lastPushedLocalVersion !== existingTask.right.updatedAt
      if (remoteChanged && localChanged) {
        const conflict = yield* createSyncConflict({
          provider: LINEAR_PROVIDER_ID,
          localRecord: existingLink.data.localRecord,
          remoteRecord: {
            id: issue.id,
            ...(issue.url === undefined || issue.url === null ? {} : { url: issue.url }),
          },
          fields: conflictFields(existingTask.right, mapped.data.taskFields),
        })
        if (!conflict.ok) {
          return conflict
        }

        if (conflict.data.event !== undefined) {
          const event = yield* appendAndCollect(events, {
            direction: "pull",
            data: {
              ...conflict.data.event,
              fields: [...conflict.data.event.fields],
            },
          })
          if (!event.ok) {
            return event
          }
        }
        conflicts += 1
        continue
      }

      if (!remoteChanged) {
        const event = yield* appendAndCollect(events, {
          direction: "pull",
          data: {
            result: "skipped",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: existingTask.right.id,
            remoteId: issue.id,
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
        const event = yield* appendAndCollect(events, {
          direction: "pull",
          data: {
            result: "skipped",
            providerId: LINEAR_PROVIDER_ID,
            entityType: "task",
            entityId: existingTask.right.id,
            remoteId: issue.id,
            reason: "dry_run",
          },
        })
        if (!event.ok) {
          return event
        }
        skipped += 1
        continue
      }

      const now = yield* nowIso()
      const nextTask = parseTask({
        ...existingTask.right,
        updatedAt: now,
        ...mapped.data.taskFields,
      })
      if (!nextTask.ok) {
        return nextTask
      }

      const saved = yield* Effect.either(taskRepo.update(nextTask.data))
      if (saved._tag === "Left") {
        return repositoryError(saved.left)
      }

      const linked = yield* upsertExternalLink({
        provider: LINEAR_PROVIDER_ID,
        localRecord: existingLink.data.localRecord,
        remoteRecord: mapped.data.remoteRecord,
        lastSeenRemoteVersion: mapped.data.lastSeenRemoteVersion,
        lastPushedLocalVersion: nextTask.data.updatedAt,
      })
      if (!linked.ok) {
        return linked
      }

      const event = yield* appendAndCollect(events, {
        direction: "pull",
        data: {
          result: "updated",
          providerId: LINEAR_PROVIDER_ID,
          entityType: "task",
          entityId: nextTask.data.id,
          remoteId: issue.id,
          fields: ["title", "description", "status", "priority"],
        },
      })
      if (!event.ok) {
        return event
      }
      updated += 1
    }

    const nextCursor = buildNextCursor(response.right.issues?.pageInfo, limit)
    return {
      ok: true,
      data: {
        imported,
        updated,
        skipped,
        conflicts,
        events,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      },
    }
  })

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

const findLinkByRemoteId = (
  remoteRecordId: string
): Effect.Effect<ToolResult<ExternalLink | undefined>, never, ExternalLinkRepositoryShape> =>
  Effect.gen(function* () {
    const result = yield* findExternalLink({
      provider: LINEAR_PROVIDER_ID,
      remoteRecordId,
      limit: 2,
    })
    if (!result.ok) {
      return result
    }
    if (result.data.externalLinks.length > 1) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: "Multiple external links matched one Linear issue.",
          details: { remoteRecordId },
        },
      }
    }

    return {
      ok: true,
      data: result.data.externalLinks[0],
    }
  })

const appendAndCollect = (
  events: SyncEvent[],
  input: Parameters<typeof appendSyncEvent>[0]
): Effect.Effect<ToolResult<undefined>, never, SyncEventRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const result = yield* appendSyncEvent(input)
    if (!result.ok) {
      return result
    }
    events.push(result.data.syncEvent)
    return {
      ok: true,
      data: undefined,
    }
  })

const parseTask = (value: unknown): ToolResult<Task> => {
  const parsed = TaskSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Task validation failed.",
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      },
    }
  }

  return { ok: true, data: parsed.data }
}

type LinearMappedTaskFields = {
  readonly title: string
  readonly description: string
  readonly status: Task["status"]
  readonly priority: number
}

const conflictFields = (task: Task, remote: LinearMappedTaskFields) =>
  (["title", "description", "status", "priority"] as const).map((path) => ({
    path,
    localValue: task[path],
    remoteValue: remote[path],
  }))

const buildNextCursor = (
  pageInfo: { readonly hasNextPage?: boolean; readonly endCursor?: string | null } | undefined,
  pageSize: number
): SyncCursor | undefined =>
  pageInfo?.hasNextPage === true && typeof pageInfo.endCursor === "string"
    ? {
        providerId: LINEAR_PROVIDER_ID,
        cursor: pageInfo.endCursor,
        pageSize,
      }
    : undefined

const providerFailure = (error: unknown): ToolResult<never> => ({
  ok: false,
  error: {
    code: "provider_error",
    message: "Linear pull failed.",
    details: { error },
  },
})

const repositoryError = (cause: unknown): ToolResult<never> => ({
  ok: false,
  error: {
    code: "storage_error",
    message: "Repository operation failed.",
    details: { cause },
  },
})

const LINEAR_PULL_ISSUES_QUERY = `
query LinearPullIssues($first: Int!, $after: String, $since: DateTime, $teamId: String, $projectId: String) {
  issues(first: $first, after: $after, filter: { updatedAt: { gte: $since }, team: { id: { eq: $teamId } }, project: { id: { eq: $projectId } } }) {
    nodes {
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
    pageInfo { hasNextPage endCursor }
  }
}
`
