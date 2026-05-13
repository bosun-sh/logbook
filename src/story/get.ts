import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import { repositoryError } from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

export type GetStoryInput = {
  readonly id: string
}

type GetStoryResult = {
  readonly story: Story
}

export const getStory = (
  input: GetStoryInput
): Effect.Effect<ToolResult<GetStoryResult>, never, StoryRepositoryShape> =>
  Effect.gen(function* () {
    const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const story = yield* Effect.either(repo.get(input.id))
    if (story._tag === "Left") {
      return repositoryError(story.left)
    }

    const parsed = StorySchema.safeParse(story.right)
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
