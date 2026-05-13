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

export type UpdateContextEntryInput = {
  readonly id: string
  readonly title?: string | undefined
  readonly body?: string | undefined
  readonly topics?: readonly string[] | undefined
  readonly source?:
    | {
        readonly type: "manual" | "file" | "url" | "sync" | "task_comment"
        readonly uri?: string | undefined
        readonly recordId?: string | undefined
      }
    | undefined
  readonly relevanceHints?: readonly string[] | undefined
}

type UpdateContextEntryResult = {
  readonly contextEntry: ContextEntry
}

const textEncoder = new TextEncoder()
const BODY_MAX_BYTES = 262_144

export const updateContextEntry = (
  input: UpdateContextEntryInput
): Effect.Effect<
  ToolResult<UpdateContextEntryResult>,
  never,
  ContextRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const validationIssue = validateUpdateContextInput(input)
    if (validationIssue) {
      return validationIssue
    }

    const normalizedTopics = input.topics === undefined ? undefined : normalizeTopics(input.topics)
    if (normalizedTopics !== undefined && !normalizedTopics.ok) {
      return normalizedTopics
    }

    const repo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const existing = yield* Effect.either(repo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const candidate = {
      ...existing.right,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(normalizedTopics === undefined ? {} : { topics: [...normalizedTopics.data] }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.relevanceHints === undefined ? {} : { relevanceHints: [...input.relevanceHints] }),
    }

    if (contextEntriesEqual(existing.right, candidate)) {
      return {
        ok: true,
        data: {
          contextEntry: existing.right,
        },
      }
    }

    const now = yield* nowIso()
    const entryCandidate = {
      ...candidate,
      updatedAt: now,
      topics: [...candidate.topics],
      attachedTo: [...candidate.attachedTo],
      relevanceHints: [...candidate.relevanceHints],
    }

    const parsed = ContextEntrySchema.safeParse(entryCandidate)
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    const saved = yield* Effect.either(repo.update(parsed.data))
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

const validateUpdateContextInput = (input: UpdateContextEntryInput): ToolResult<never> | null => {
  if (input.title !== undefined) {
    const title = TitleSchema.safeParse(input.title)
    if (!title.success) {
      return validationErrorFromIssues(title.error.issues.map((issue) => issue.message))
    }
  }

  if (input.body !== undefined) {
    if (typeof input.body !== "string" || input.body.trim().length === 0) {
      return validationError("body must not be empty", { field: "body" })
    }

    if (byteLength(input.body) > BODY_MAX_BYTES) {
      return validationError("body exceeds 262144 bytes", {
        field: "body",
        maxBytes: BODY_MAX_BYTES,
      })
    }
  }

  return null
}

const contextEntriesEqual = (current: ContextEntry, next: Partial<ContextEntry>): boolean =>
  current.title === next.title &&
  current.body === next.body &&
  arraysEqual(current.topics, next.topics) &&
  arraysEqual(current.relevanceHints, next.relevanceHints) &&
  arraysEqual(current.attachedTo, next.attachedTo) &&
  sourceEquals(current.source, next.source)

const arraysEqual = <T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right
  }

  if (left.length !== right.length) {
    return false
  }

  return left.every((entry, index) => Object.is(entry, right[index]))
}

const sourceEquals = (
  left:
    | {
        readonly type: "manual" | "file" | "url" | "sync" | "task_comment"
        readonly uri?: string | undefined
        readonly recordId?: string | undefined
      }
    | undefined,
  right:
    | {
        readonly type: "manual" | "file" | "url" | "sync" | "task_comment"
        readonly uri?: string | undefined
        readonly recordId?: string | undefined
      }
    | undefined
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

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
