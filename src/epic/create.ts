import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { repositoryError, validateCreateEpicInput } from "./rules.js"
import { type Epic, EpicSchema } from "./schema.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type CreateEpicInput = {
  readonly title: string
  readonly description: string
  readonly outcome: string
  readonly owner?: Epic["owner"] | undefined
  readonly storyIds?: readonly string[] | undefined
  readonly contextEntryIds?: readonly string[] | undefined
}

type CreateEpicResult = {
  readonly epic: Epic
}

export const createEpic = (
  input: CreateEpicInput
): Effect.Effect<ToolResult<CreateEpicResult>, never, EpicRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const validationError = validateCreateEpicInput(input)
    if (validationError) {
      return validationError
    }

    const now = yield* nowIso()
    const epicCandidate = {
      id: createId("epic"),
      schemaVersion: "2" as const,
      kind: "epic" as const,
      createdAt: now,
      updatedAt: now,
      title: input.title,
      description: input.description,
      outcome: input.outcome,
      status: "backlog" as const,
      storyIds: [...(input.storyIds ?? [])],
      contextEntryIds: [...(input.contextEntryIds ?? [])],
      externalLinks: [],
      ...(input.owner === undefined ? {} : { owner: input.owner }),
    }

    const parsed = EpicSchema.safeParse(epicCandidate)
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const saved = yield* Effect.either(repo.create(parsed.data))
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

const validationErrorFromIssues = (issues: readonly string[]): ToolResult<never> =>
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
