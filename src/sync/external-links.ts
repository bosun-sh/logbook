import { type ExternalLink, ExternalLinkSchema } from "@logbook/context/schema.js"
import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { LocalRecordRefSchema } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { z } from "zod"

const DEFAULT_LIST_LIMIT = 500
const MAX_LIST_LIMIT = 500

type ExternalLinkRepositoryShape = {
  create(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
  get(id: string): Effect.Effect<ExternalLink, unknown>
  list(): Effect.Effect<readonly ExternalLink[], unknown>
  update(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
}

const ExternalLinkRepository =
  Context.GenericTag<ExternalLinkRepositoryShape>("ExternalLinkRepository")

const RemoteRecordSchema = ExternalLinkSchema.shape.remoteRecord

const UpsertExternalLinkInputSchema = z
  .object({
    provider: z.string().min(1),
    localRecord: LocalRecordRefSchema,
    remoteRecord: RemoteRecordSchema,
    lastSyncedAt: ExternalLinkSchema.shape.lastSyncedAt,
    lastSeenRemoteVersion: ExternalLinkSchema.shape.lastSeenRemoteVersion,
    lastPushedLocalVersion: ExternalLinkSchema.shape.lastPushedLocalVersion,
  })
  .strict()

type UpsertExternalLinkInput = z.input<typeof UpsertExternalLinkInputSchema>

type UpsertExternalLinkResult = {
  readonly externalLink: ExternalLink
  readonly created: boolean
}

const FindExternalLinkInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    localRecord: LocalRecordRefSchema.optional(),
    remoteRecordId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.id !== undefined) {
      return
    }

    if (input.provider === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provider"],
        message: "provider is required unless id is supplied",
      })
    }
  })

type FindExternalLinkInput = z.input<typeof FindExternalLinkInputSchema>

type FindExternalLinkResult = {
  readonly externalLinks: readonly ExternalLink[]
  readonly hasMore: boolean
}

const UpdateExternalLinkSnapshotInputSchema = z
  .object({
    id: z.string().min(1),
    lastSyncedAt: ExternalLinkSchema.shape.lastSyncedAt,
    lastSeenRemoteVersion: ExternalLinkSchema.shape.lastSeenRemoteVersion,
    lastPushedLocalVersion: ExternalLinkSchema.shape.lastPushedLocalVersion,
  })
  .strict()

type UpdateExternalLinkSnapshotInput = z.input<typeof UpdateExternalLinkSnapshotInputSchema>

type UpdateExternalLinkSnapshotResult = {
  readonly externalLink: ExternalLink
}

export const upsertExternalLink = (
  input: UpsertExternalLinkInput
): Effect.Effect<
  ToolResult<UpsertExternalLinkResult>,
  never,
  ExternalLinkRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const parsedInput = UpsertExternalLinkInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* ExternalLinkRepository) as unknown as ExternalLinkRepositoryShape
    const existingLinks = yield* Effect.either(repo.list())
    if (existingLinks._tag === "Left") {
      return repositoryError(existingLinks.left)
    }

    const matches = existingLinks.right.filter((link) =>
      sameActiveTuple(
        link,
        parsedInput.data.provider,
        parsedInput.data.localRecord,
        parsedInput.data.remoteRecord
      )
    )

    if (matches.length > 1) {
      return conflictError(
        "Duplicate active external links exist for the provider/local/remote tuple.",
        {
          provider: parsedInput.data.provider,
          localRecord: parsedInput.data.localRecord,
          remoteRecord: parsedInput.data.remoteRecord,
          externalLinkIds: matches.map((link) => link.id),
        }
      )
    }

    const timestamp = parsedInput.data.lastSyncedAt ?? (yield* nowIso())

    if (matches.length === 1) {
      const existing = matches[0]
      if (existing === undefined) {
        return conflictError(
          "Duplicate active external links exist for the provider/local/remote tuple."
        )
      }

      const next = parseExternalLink({
        ...existing,
        updatedAt: timestamp,
        remoteRecord: parsedInput.data.remoteRecord,
        lastSyncedAt: timestamp,
        ...optionalSnapshotFields(parsedInput.data),
      })
      if (!next.ok) {
        return next
      }

      const saved = yield* Effect.either(repo.update(next.data))
      if (saved._tag === "Left") {
        return repositoryError(saved.left)
      }

      return {
        ok: true,
        data: {
          externalLink: saved.right,
          created: false,
        },
      }
    }

    const candidate = parseExternalLink({
      id: createId("external_link"),
      schemaVersion: "2" as const,
      kind: "external_link" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      provider: parsedInput.data.provider,
      localRecord: parsedInput.data.localRecord,
      remoteRecord: parsedInput.data.remoteRecord,
      lastSyncedAt: timestamp,
      ...optionalSnapshotFields(parsedInput.data),
    })
    if (!candidate.ok) {
      return candidate
    }

    const saved = yield* Effect.either(repo.create(candidate.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        externalLink: saved.right,
        created: true,
      },
    }
  })

export const findExternalLink = (
  input: FindExternalLinkInput
): Effect.Effect<ToolResult<FindExternalLinkResult>, never, ExternalLinkRepositoryShape> =>
  Effect.gen(function* () {
    const parsedInput = FindExternalLinkInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* ExternalLinkRepository) as unknown as ExternalLinkRepositoryShape
    if (parsedInput.data.id !== undefined) {
      const link = yield* Effect.either(repo.get(parsedInput.data.id))
      if (link._tag === "Left") {
        return repositoryError(link.left)
      }

      return {
        ok: true,
        data: {
          externalLinks: [link.right],
          hasMore: false,
        },
      }
    }

    const links = yield* Effect.either(repo.list())
    if (links._tag === "Left") {
      return repositoryError(links.left)
    }

    const limit = parsedInput.data.limit ?? DEFAULT_LIST_LIMIT
    const filtered = links.right.filter((link) => matchesFindInput(link, parsedInput.data))
    const hasMore = filtered.length > limit
    const externalLinks = filtered.slice(0, limit)

    return hasMore
      ? {
          ok: true,
          data: {
            externalLinks,
            hasMore,
          },
          warnings: [
            {
              code: "result_truncated",
              message: "External link list exceeded the 500 item limit.",
              details: {
                limit,
                hasMore,
              },
            },
          ],
        }
      : {
          ok: true,
          data: {
            externalLinks,
            hasMore,
          },
        }
  })

export const updateExternalLinkSnapshot = (
  input: UpdateExternalLinkSnapshotInput
): Effect.Effect<
  ToolResult<UpdateExternalLinkSnapshotResult>,
  never,
  ExternalLinkRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const parsedInput = UpdateExternalLinkSnapshotInputSchema.safeParse(input)
    if (!parsedInput.success) {
      return validationError(parsedInput.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* ExternalLinkRepository) as unknown as ExternalLinkRepositoryShape
    const existing = yield* Effect.either(repo.get(parsedInput.data.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const timestamp = parsedInput.data.lastSyncedAt ?? (yield* nowIso())
    const next = parseExternalLink({
      ...existing.right,
      updatedAt: timestamp,
      lastSyncedAt: timestamp,
      ...optionalSnapshotFields(parsedInput.data),
    })
    if (!next.ok) {
      return next
    }

    const saved = yield* Effect.either(repo.update(next.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        externalLink: saved.right,
      },
    }
  })

const sameActiveTuple = (
  link: ExternalLink,
  provider: string,
  localRecord: ExternalLink["localRecord"],
  remoteRecord: ExternalLink["remoteRecord"]
): boolean =>
  link.deletedAt === undefined &&
  link.provider === provider &&
  link.localRecord.kind === localRecord.kind &&
  link.localRecord.id === localRecord.id &&
  link.remoteRecord.id === remoteRecord.id &&
  link.remoteRecord.type === remoteRecord.type

const matchesFindInput = (
  link: ExternalLink,
  input: z.output<typeof FindExternalLinkInputSchema>
): boolean => {
  if (link.deletedAt !== undefined) {
    return false
  }

  if (input.provider !== undefined && link.provider !== input.provider) {
    return false
  }

  if (
    input.localRecord !== undefined &&
    (link.localRecord.kind !== input.localRecord.kind ||
      link.localRecord.id !== input.localRecord.id)
  ) {
    return false
  }

  return input.remoteRecordId === undefined || link.remoteRecord.id === input.remoteRecordId
}

const optionalSnapshotFields = (input: {
  readonly lastSeenRemoteVersion?: string | undefined
  readonly lastPushedLocalVersion?: string | undefined
}): Pick<ExternalLink, "lastSeenRemoteVersion" | "lastPushedLocalVersion"> => {
  const snapshot: Partial<Pick<ExternalLink, "lastSeenRemoteVersion" | "lastPushedLocalVersion">> =
    {}
  if (input.lastSeenRemoteVersion !== undefined) {
    snapshot.lastSeenRemoteVersion = input.lastSeenRemoteVersion
  }
  if (input.lastPushedLocalVersion !== undefined) {
    snapshot.lastPushedLocalVersion = input.lastPushedLocalVersion
  }

  return snapshot
}

const parseExternalLink = (value: unknown): ToolResult<ExternalLink> => {
  const parsed = ExternalLinkSchema.safeParse(value)
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((issue) => issue.message))
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

const validationError = (issues: readonly string[]): ToolResult<never> =>
  ({
    ok: false,
    error: {
      code: "validation_error",
      message: issues[0] ?? "validation failed",
      details: {
        issues,
      },
    },
  }) as ToolResult<never>

const conflictError = (message: string, details?: Record<string, unknown>): ToolResult<never> =>
  ({
    ok: false,
    error: {
      code: "conflict",
      message,
      ...(details === undefined ? {} : { details }),
    },
  }) as ToolResult<never>

const repositoryError = (error: unknown): ToolResult<never> => {
  if (isRepositoryError(error)) {
    return {
      ok: false,
      error: {
        code: mapRepositoryErrorCode(error._tag),
        message: error.message,
        details: {
          repositoryTag: error._tag,
        },
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "External link repository operation failed.",
    },
  }
}

const isRepositoryError = (
  error: unknown
): error is { readonly _tag: string; readonly message: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof (error as { readonly _tag?: unknown })._tag === "string" &&
  "message" in error &&
  typeof (error as { readonly message?: unknown }).message === "string"

const mapRepositoryErrorCode = (
  tag: string
): "conflict" | "not_found" | "validation_error" | "storage_error" => {
  switch (tag) {
    case "conflict":
      return "conflict"
    case "not_found":
      return "not_found"
    case "validation_error":
    case "malformed_record":
      return "validation_error"
    default:
      return "storage_error"
  }
}
