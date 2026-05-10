import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { TitleSchema } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { type ContextEntry, ContextEntrySchema } from "./schema.js"
import { normalizeTopics } from "./topics.js"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

const ContextRepository = Context.GenericTag<ContextRepositoryShape>("ContextRepository")

export type CreateContextEntryInput = {
  readonly title: string
  readonly body: string
  readonly topics?: readonly string[] | undefined
  readonly source?:
    | {
        readonly type: "manual" | "file" | "url" | "sync" | "task_comment"
        readonly uri?: string | undefined
        readonly recordId?: string | undefined
      }
    | undefined
  readonly attachedTo?:
    | readonly {
        readonly kind: "epic" | "story" | "task" | "topic"
        readonly id: string
      }[]
    | undefined
}

type CreateContextEntryResult = {
  readonly contextEntry: ContextEntry
}

const textEncoder = new TextEncoder()
const BODY_MAX_BYTES = 262_144

export const createContextEntry = (
  input: CreateContextEntryInput
): Effect.Effect<
  ToolResult<CreateContextEntryResult>,
  never,
  ContextRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const validationIssue = validateCreateContextInput(input)
    if (validationIssue) {
      return validationIssue
    }

    const normalizedTopics = normalizeTopics(input.topics)
    if (!normalizedTopics.ok) {
      return normalizedTopics
    }

    const now = yield* nowIso()
    const entryCandidate = {
      id: createId("context_entry"),
      schemaVersion: "2" as const,
      kind: "context_entry" as const,
      createdAt: now,
      updatedAt: now,
      title: input.title,
      body: input.body,
      topics: [...normalizedTopics.data],
      ...(input.source === undefined ? {} : { source: input.source }),
      attachedTo: [...(input.attachedTo ?? [])],
      relevanceHints: [],
    }

    const parsed = ContextEntrySchema.safeParse(entryCandidate)
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const saved = yield* Effect.either(repo.create(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        contextEntry: parsed.data,
      },
    }
  })

const validateCreateContextInput = (input: CreateContextEntryInput): ToolResult<never> | null => {
  const title = TitleSchema.safeParse(input.title)
  if (!title.success) {
    return validationErrorFromIssues(title.error.issues.map((issue) => issue.message))
  }

  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    return validationError("body must not be empty", { field: "body" })
  }

  if (byteLength(input.body) > BODY_MAX_BYTES) {
    return validationError("body exceeds 262144 bytes", {
      field: "body",
      maxBytes: BODY_MAX_BYTES,
    })
  }

  return null
}

const byteLength = (value: string): number => textEncoder.encode(value).length

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

const validationErrorFromIssues = (issues: readonly string[]): ToolResult<never> =>
  validationError(issues[0] ?? "validation failed", {
    issues,
  })

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )

    const id = typeof tagged.id === "string" ? tagged.id : undefined
    return {
      ok: false,
      error: {
        code: String(tagged._tag),
        message:
          typeof tagged.message === "string" ? tagged.message : "repository operation failed",
        ...(id === undefined || Object.hasOwn(details, "id")
          ? { details }
          : { details: { ...details, id } }),
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "repository operation failed",
    },
  }
}
