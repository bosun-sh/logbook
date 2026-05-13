import type { ToolResult } from "@logbook/shared/result.js"
import { type Clock, Context, Effect } from "effect"
import { repositoryError, validateEpicDelete } from "./rules.js"
import { type Epic, EpicSchema } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type DeleteEpicInput = {
  readonly id: string
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

type DeleteEpicResult = {
  readonly epic: Epic
}

export const deleteEpic = (
  input: DeleteEpicInput
): Effect.Effect<ToolResult<DeleteEpicResult>, never, EpicRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const existing = yield* Effect.either(repo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const deleteRule = validateEpicDelete(existing.right, {
      force: input.force,
      cascade: input.cascade,
    })
    if (deleteRule) {
      return deleteRule
    }

    const deleted = yield* Effect.either(repo.tombstone(input.id))
    if (deleted._tag === "Left") {
      return repositoryError(deleted.left)
    }

    const parsed = EpicSchema.safeParse(deleted.right)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "validation failed",
          details: {
            issues: parsed.error.issues.map((issue) => issue.message),
          },
        },
      }
    }

    return {
      ok: true,
      data: {
        epic: parsed.data,
      },
    }
  })
