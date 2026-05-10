import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import { repositoryError } from "./rules.js"
import { type Epic, EpicSchema } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type GetEpicInput = {
  readonly id: string
}

type GetEpicResult = {
  readonly epic: Epic
}

export const getEpic = (
  input: GetEpicInput
): Effect.Effect<ToolResult<GetEpicResult>, never, EpicRepositoryShape> =>
  Effect.gen(function* () {
    const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const epic = yield* Effect.either(repo.get(input.id))
    if (epic._tag === "Left") {
      return repositoryError(epic.left)
    }

    const parsed = EpicSchema.safeParse(epic.right)
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
