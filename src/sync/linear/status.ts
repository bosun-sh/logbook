import type { ToolResult } from "@logbook/shared/result.js"
import { readLinearApiToken, readLinearWorkspaceConfig } from "@logbook/sync/linear/config.js"
import type { LinearGraphQLClient } from "@logbook/sync/linear/transport.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import { type Clock, Context, Effect } from "effect"

const LINEAR_PROVIDER_ID = "linear"
const LINEAR_HEALTH_OPERATION = "LinearHealthCheck"

type SyncEventRepositoryShape = {
  create(event: SyncEvent): Effect.Effect<SyncEvent, unknown>
  list(): Effect.Effect<readonly SyncEvent[], unknown>
}

type SyncConflictRepositoryShape = {
  create(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
  get(id: string): Effect.Effect<SyncConflict, unknown>
  list(): Effect.Effect<readonly SyncConflict[], unknown>
  update(conflict: SyncConflict): Effect.Effect<SyncConflict, unknown>
}

const SyncEventRepository = Context.GenericTag<SyncEventRepositoryShape>("SyncEventRepository")
const SyncConflictRepository =
  Context.GenericTag<SyncConflictRepositoryShape>("SyncConflictRepository")
const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

export type GetLinearStatusInput = {
  readonly checkProvider?: boolean | undefined
}

export type LinearStatus = {
  readonly configured: boolean
  readonly reachable?: boolean | undefined
  readonly authenticated?: boolean | undefined
  readonly lastSyncAt?: string | undefined
  readonly pendingConflicts: number
  readonly warnings?: readonly ToolWarning[] | undefined
}

export type GetLinearStatusResult = {
  readonly status: LinearStatus
  readonly warnings?: readonly ToolWarning[] | undefined
}

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]
type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

type LinearHealthResponse = {
  readonly viewer?: {
    readonly id?: string
  } | null
}

export const getLinearStatus = (
  input: GetLinearStatusInput = {}
): Effect.Effect<
  ToolResult<GetLinearStatusResult>,
  never,
  LinearGraphQLClient | SyncEventRepositoryShape | SyncConflictRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const configResult = yield* Effect.promise(() => readLinearWorkspaceConfig())
    if (!configResult.ok) {
      return configResult
    }

    const config = configResult.data
    const warnings: ToolWarning[] = []
    const configured = config !== undefined
    const token = readLinearApiToken(config)
    const authenticated = token !== undefined
    const events = yield* loadEvents()
    if (!events.ok) {
      return events
    }
    const conflicts = yield* loadConflicts()
    if (!conflicts.ok) {
      return conflicts
    }

    const lastSyncAt = latestSuccessfulSyncAt(events.data)
    const pendingConflicts = conflicts.data.filter(
      (conflict) => conflict.provider === LINEAR_PROVIDER_ID && conflict.status === "open"
    ).length

    let reachable: boolean | undefined
    if (input.checkProvider !== false) {
      if (!authenticated) {
        warnings.push({
          code: "provider_warning",
          message: "Linear is configured but its API token environment variable is not set.",
          details: {
            provider: LINEAR_PROVIDER_ID,
            apiTokenEnv: config?.apiTokenEnv ?? "LINEAR_API_KEY",
          },
        })
        reachable = false
      } else {
        const client = (yield* LinearGraphQLClientTag) as unknown as LinearGraphQLClient
        const health = yield* Effect.either(
          client.request<LinearHealthResponse>({
            operationName: LINEAR_HEALTH_OPERATION,
            query: LINEAR_HEALTH_QUERY,
            variables: {},
          })
        )
        if (health._tag === "Left") {
          warnings.push(providerWarning(health.left))
          reachable = false
        } else if (health.right.viewer === undefined || health.right.viewer === null) {
          warnings.push({
            code: "provider_warning",
            message: "Linear health check returned no viewer.",
            details: {
              provider: LINEAR_PROVIDER_ID,
            },
          })
          reachable = false
        } else {
          reachable = true
        }
      }
    }

    const status: LinearStatus = {
      configured,
      authenticated,
      pendingConflicts,
      ...(lastSyncAt === undefined ? {} : { lastSyncAt }),
      ...(reachable === undefined ? {} : { reachable }),
      ...(warnings.length === 0 ? {} : { warnings }),
    }

    return {
      ok: true,
      data: {
        status,
        ...(warnings.length === 0 ? {} : { warnings }),
      },
    }
  })

const loadEvents = (): Effect.Effect<
  ToolResult<readonly SyncEvent[]>,
  never,
  SyncEventRepositoryShape
> =>
  Effect.gen(function* () {
    const repo = (yield* SyncEventRepository) as unknown as SyncEventRepositoryShape
    const listed = yield* Effect.either(repo.list())
    if (listed._tag === "Left") {
      return {
        ok: false,
        error: storageError(listed.left),
      }
    }
    return { ok: true, data: listed.right }
  })

const loadConflicts = (): Effect.Effect<
  ToolResult<readonly SyncConflict[]>,
  never,
  SyncConflictRepositoryShape
> =>
  Effect.gen(function* () {
    const repo = (yield* SyncConflictRepository) as unknown as SyncConflictRepositoryShape
    const listed = yield* Effect.either(repo.list())
    if (listed._tag === "Left") {
      return {
        ok: false,
        error: storageError(listed.left),
      }
    }
    return { ok: true, data: listed.right }
  })

const latestSuccessfulSyncAt = (events: readonly SyncEvent[]): string | undefined => {
  const successful = events.filter(
    (event) =>
      event.provider === LINEAR_PROVIDER_ID &&
      event.result !== "failed" &&
      event.result !== "conflict"
  )
  successful.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  )
  return successful[0]?.createdAt
}

const providerWarning = (error: unknown): ToolWarning => ({
  code: "provider_warning",
  message: "Linear provider health check failed.",
  details: {
    provider: LINEAR_PROVIDER_ID,
    ...(isProviderError(error) ? { error } : { error: String(error) }),
  },
})

const storageError = (cause: unknown): ToolError => ({
  code: "storage_error",
  message: "Repository operation failed.",
  details: { cause },
})

const isProviderError = (
  value: unknown
): value is {
  readonly providerId: string
  readonly code: string
  readonly retryable: boolean
  readonly message: string
  readonly details?: Record<string, unknown>
} =>
  isRecord(value) &&
  typeof value.providerId === "string" &&
  typeof value.code === "string" &&
  typeof value.retryable === "boolean" &&
  typeof value.message === "string"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const LINEAR_HEALTH_QUERY = `
query LinearHealthCheck {
  viewer {
    id
  }
}
`
