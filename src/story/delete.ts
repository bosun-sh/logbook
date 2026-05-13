import type { ToolResult } from "@logbook/shared/result.js"
import { type Clock, Context, Effect } from "effect"
import { repositoryError, validateStoryDelete } from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

export type DeleteStoryInput = {
  readonly id: string
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

type DeleteStoryResult = {
  readonly story: Story
}

export const deleteStory = (
  input: DeleteStoryInput
): Effect.Effect<ToolResult<DeleteStoryResult>, never, StoryRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const existing = yield* Effect.either(repo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const deleteRule = validateStoryDelete(existing.right, {
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

    const parsed = StorySchema.safeParse(deleted.right)
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
        story: parsed.data,
      },
    }
  })
