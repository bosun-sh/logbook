import type { ExternalLink } from "@logbook/context/schema.js"
import type { ToolResult } from "@logbook/shared/result.js"

type SnapshotFields = Readonly<Record<string, unknown>>

type BaseSnapshot = {
  readonly remoteVersion?: string
  readonly localVersion?: string
  readonly fields: SnapshotFields
}

type LocalSnapshot = {
  readonly version: string
  readonly fields: SnapshotFields
}

type RemoteSnapshot = {
  readonly version: string
  readonly fields: SnapshotFields
}

type SnapshotExternalLink = Pick<ExternalLink, "lastSeenRemoteVersion" | "lastPushedLocalVersion">

type BaseLocalRemoteInput = {
  readonly externalLink: SnapshotExternalLink
  readonly base: BaseSnapshot
  readonly local: LocalSnapshot
  readonly remote: RemoteSnapshot
  readonly fieldPaths: readonly string[]
}

type FieldDecisionAction = "accept_remote" | "keep_local" | "skip" | "conflict"

type BaseSnapshotAction = FieldDecisionAction | "merge"

type FieldDecision = {
  readonly action: FieldDecisionAction
  readonly path: string
}

type BaseLocalRemoteDecision = {
  readonly action: BaseSnapshotAction
  readonly fields: readonly string[]
  readonly fieldDecisions: readonly FieldDecision[]
}

export const compareBaseLocalRemote = (
  input: BaseLocalRemoteInput
): ToolResult<BaseLocalRemoteDecision> => {
  const versionValidation = validateBaseVersions(input)
  if (!versionValidation.ok) {
    return versionValidation
  }

  if (input.fieldPaths.length === 0) {
    return validationError("At least one field path is required for sync comparison.")
  }

  const fieldDecisions = input.fieldPaths.map((path) =>
    decideField(path, input.base, input.local, input.remote)
  )
  const conflictFields = fieldDecisions
    .filter((decision) => decision.action === "conflict")
    .map((decision) => decision.path)
  if (conflictFields.length > 0) {
    return {
      ok: true,
      data: {
        action: "conflict",
        fields: conflictFields,
        fieldDecisions,
      },
    }
  }

  const fields = fieldDecisions.map((decision) => decision.path)
  const actions = new Set(fieldDecisions.map((decision) => decision.action))
  const action = actions.size === 1 ? (fieldDecisions[0]?.action ?? "skip") : "merge"

  return {
    ok: true,
    data: {
      action,
      fields,
      fieldDecisions,
    },
  }
}

const validateBaseVersions = (input: BaseLocalRemoteInput): ToolResult<undefined> => {
  if (input.externalLink.lastSeenRemoteVersion !== input.base.remoteVersion) {
    return syncConflictError("Base remote snapshot version does not match the external link.", {
      expected: input.externalLink.lastSeenRemoteVersion,
      actual: input.base.remoteVersion,
    })
  }

  if (input.externalLink.lastPushedLocalVersion !== input.base.localVersion) {
    return syncConflictError("Base local snapshot version does not match the external link.", {
      expected: input.externalLink.lastPushedLocalVersion,
      actual: input.base.localVersion,
    })
  }

  return {
    ok: true,
    data: undefined,
  }
}

const decideField = (
  path: string,
  base: BaseSnapshot,
  local: LocalSnapshot,
  remote: RemoteSnapshot
): FieldDecision => {
  const baseValue = base.fields[path]
  const localValue = local.fields[path]
  const remoteValue = remote.fields[path]
  const localChanged = !deepEqual(localValue, baseValue)
  const remoteChanged = !deepEqual(remoteValue, baseValue)

  if (!localChanged && remoteChanged) {
    return { action: "accept_remote", path }
  }
  if (localChanged && !remoteChanged) {
    return { action: "keep_local", path }
  }
  if (deepEqual(localValue, remoteValue)) {
    return { action: "skip", path }
  }

  return { action: "conflict", path }
}

const validationError = (message: string): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
  },
})

const syncConflictError = (
  message: string,
  details: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "sync_conflict",
    message,
    details,
  },
})

const deepEqual = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right)
