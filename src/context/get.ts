import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import { type ContextEntry, ContextEntrySchema } from "./schema.js"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

const ContextRepository = Context.GenericTag<ContextRepositoryShape>("ContextRepository")

export type GetContextEntryInput = {
  readonly id: string
}

type GetContextEntryResult = {
  readonly contextEntry: ContextEntry
}

export const getContextEntry = (
  input: GetContextEntryInput
): Effect.Effect<ToolResult<GetContextEntryResult>, never, ContextRepositoryShape> =>
  Effect.gen(function* () {
    const repo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const entry = yield* Effect.either(repo.get(input.id))
    if (entry._tag === "Left") {
      return repositoryError(entry.left)
    }

    const parsed = ContextEntrySchema.safeParse(entry.right)
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    return {
      ok: true,
      data: {
        contextEntry: parsed.data,
      },
    }
  })

const validationErrorFromIssues = (issues: readonly string[]): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message: issues[0] ?? "validation failed",
    details: {
      issues,
    },
  },
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
