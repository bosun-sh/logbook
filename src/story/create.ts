import type { Epic } from "@logbook/epic/schema.js"
import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Context, Effect } from "effect"
import { validateHierarchyLink } from "./hierarchy.js"
import { repositoryError, validateCreateStoryInput } from "./rules.js"
import { type Story, StorySchema } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")
const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

export type CreateStoryInput = {
  readonly epicId: string
  readonly title: string
  readonly description: string
  readonly userValue: string
}

type CreateStoryResult = {
  readonly story: Story
}

export const createStory = (
  input: CreateStoryInput
): Effect.Effect<
  ToolResult<CreateStoryResult>,
  never,
  StoryRepositoryShape | EpicRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const validationIssue = validateCreateStoryInput(input)
    if (validationIssue) {
      return validationIssue
    }

    const now = yield* nowIso()
    const storyCandidate = {
      id: createId("story"),
      schemaVersion: "2" as const,
      kind: "story" as const,
      createdAt: now,
      updatedAt: now,
      epicId: input.epicId,
      title: input.title,
      description: input.description,
      userValue: input.userValue,
      status: "backlog" as const,
      taskIds: [],
      contextEntryIds: [],
      externalLinks: [],
    }

    const parsed = StorySchema.safeParse(storyCandidate)
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    const hierarchy = yield* validateHierarchyLink({
      epicId: input.epicId,
      storyId: parsed.data.id,
    })
    if (!hierarchy.ok) {
      return hierarchy
    }

    const storyRepo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const epicRepo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const saved = yield* Effect.either(storyRepo.create(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    const nextEpic = hierarchy.data.epic
    const updatedEpic = yield* Effect.either(epicRepo.update(nextEpic))
    if (updatedEpic._tag === "Left") {
      return repositoryError(updatedEpic.left)
    }

    return {
      ok: true,
      data: {
        story: parsed.data,
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
