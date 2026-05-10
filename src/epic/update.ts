import type { ToolResult } from "@logbook/shared/result.js"
import type { Assignment } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { repositoryError, validateUpdateEpicInput } from "./rules.js"
import { type Epic, EpicSchema } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type UpdateEpicInput = {
  readonly id: string
  readonly title?: string | undefined
  readonly description?: string | undefined
  readonly outcome?: string | undefined
  readonly status?: Epic["status"] | undefined
  readonly owner?: Assignment | undefined
}

type UpdateEpicResult = {
  readonly epic: Epic
}

export const updateEpic = (
  input: UpdateEpicInput
): Effect.Effect<ToolResult<UpdateEpicResult>, never, EpicRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const validationError = validateUpdateEpicInput(input)
    if (validationError) {
      return validationError
    }

    const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const existing = yield* Effect.either(repo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const candidate = {
      ...existing.right,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.owner === undefined ? {} : { owner: input.owner }),
    }

    if (epicUnchanged(existing.right, candidate)) {
      return {
        ok: true,
        data: {
          epic: existing.right,
        },
      }
    }

    const now = yield* nowIso()
    const epicCandidate = {
      ...candidate,
      updatedAt: now,
      externalLinks: [...candidate.externalLinks],
      storyIds: [...candidate.storyIds],
      contextEntryIds: [...candidate.contextEntryIds],
    }

    const parsed = EpicSchema.safeParse(epicCandidate)
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

    const saved = yield* Effect.either(repo.update(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        epic: parsed.data,
      },
    }
  })

const epicUnchanged = (current: Epic, next: Partial<Epic>): boolean =>
  current.title === next.title &&
  current.description === next.description &&
  current.outcome === next.outcome &&
  current.status === next.status &&
  JSON.stringify(current.owner) === JSON.stringify(next.owner)
