import type { SyncEvent } from "@logbook/sync/schema.js"
import type { Effect } from "effect"

export const DEFAULT_PROVIDER_RETRY_ATTEMPTS = 3

export type SyncProviderId = "linear" | string

export type SyncCursor = {
  readonly providerId: SyncProviderId
  readonly cursor: string
  readonly pageSize: number
}

export type SyncProviderError = {
  readonly providerId: SyncProviderId
  readonly code:
    | "auth_failed"
    | "rate_limited"
    | "network_error"
    | "timeout"
    | "not_found"
    | "validation_failed"
    | "remote_conflict"
    | "unknown"
  readonly retryable: boolean
  readonly message: string
  readonly details?: Record<string, unknown>
}

export type SyncRetryClassification =
  | { readonly retryable: true; readonly retryAfterMs?: number; readonly maxAttempts: number }
  | { readonly retryable: false }

export type SyncPullInput = {
  readonly since?: string
  readonly teamId?: string
  readonly projectId?: string
  readonly limit?: number
  readonly cursor?: SyncCursor
  readonly dryRun: boolean
}

export type SyncPushInput = {
  readonly taskIds?: readonly string[]
  readonly epicIds?: readonly string[]
  readonly storyIds?: readonly string[]
  readonly teamId?: string
  readonly projectId?: string
  readonly dryRun: boolean
}

export type SyncStatusInput = {
  readonly checkProvider: boolean
}

export type SyncPullResult = {
  readonly imported: number
  readonly updated: number
  readonly skipped: number
  readonly conflicts: number
  readonly events: readonly SyncEvent[]
  readonly nextCursor?: SyncCursor
}

export type SyncPushResult = {
  readonly created: number
  readonly updated: number
  readonly skipped: number
  readonly conflicts: number
  readonly events: readonly SyncEvent[]
}

type ToolWarning = {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

export type SyncProviderStatus = {
  readonly providerId: SyncProviderId
  readonly configured: boolean
  readonly reachable?: boolean
  readonly authenticated?: boolean
  readonly pendingConflicts: number
  readonly lastSyncAt?: string
  readonly warnings?: readonly ToolWarning[]
}

export interface SyncProviderPort {
  readonly providerId: SyncProviderId
  pull(input: SyncPullInput): Effect.Effect<SyncPullResult, SyncProviderError>
  push(input: SyncPushInput): Effect.Effect<SyncPushResult, SyncProviderError>
  status(input: SyncStatusInput): Effect.Effect<SyncProviderStatus, SyncProviderError>
  classifyRetry(error: SyncProviderError): SyncRetryClassification
}

export const classifySyncRetry = (error: SyncProviderError): SyncRetryClassification => {
  if (!error.retryable || !isRetryableTransportCode(error.code)) {
    return { retryable: false }
  }

  const retryAfterMs = readRetryAfterMs(error.details)
  return retryAfterMs === undefined
    ? { retryable: true, maxAttempts: DEFAULT_PROVIDER_RETRY_ATTEMPTS }
    : { retryable: true, retryAfterMs, maxAttempts: DEFAULT_PROVIDER_RETRY_ATTEMPTS }
}

const isRetryableTransportCode = (code: SyncProviderError["code"]): boolean =>
  code === "rate_limited" || code === "network_error" || code === "timeout" || code === "unknown"

const readRetryAfterMs = (details: Record<string, unknown> | undefined): number | undefined => {
  const value = details?.retryAfterMs
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
