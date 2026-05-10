import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { repositoryError, validateUpdateStoryInput } from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

export type UpdateStoryInput = {
  readonly id: string
  readonly title?: string | undefined
  readonly description?: string | undefined
  readonly userValue?: string | undefined
  readonly status?: Story["status"] | undefined
}

type UpdateStoryResult = {
  readonly story: Story
}

export const updateStory = (
  input: UpdateStoryInput
): Effect.Effect<ToolResult<UpdateStoryResult>, never, StoryRepositoryShape | Clock.Clock> =>
  Effect.gen(function* () {
    const validationIssue = validateUpdateStoryInput(input)
    if (validationIssue) {
      return validationIssue
    }

    const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const existing = yield* Effect.either(repo.get(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const candidate = {
      ...existing.right,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.userValue === undefined ? {} : { userValue: input.userValue }),
      ...(input.status === undefined ? {} : { status: input.status }),
    }

    if (storyUnchanged(existing.right, candidate)) {
      return {
        ok: true,
        data: {
          story: existing.right,
        },
      }
    }

    const now = yield* nowIso()
    const storyCandidate = {
      ...candidate,
      updatedAt: now,
      taskIds: [...candidate.taskIds],
      contextEntryIds: [...candidate.contextEntryIds],
      externalLinks: [...candidate.externalLinks],
    }

    const parsed = StorySchema.safeParse(storyCandidate)
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
        story: parsed.data,
      },
    }
  })

const storyUnchanged = (current: Story, next: Partial<Story>): boolean =>
  current.title === next.title &&
  current.description === next.description &&
  current.userValue === next.userValue &&
  current.status === next.status
