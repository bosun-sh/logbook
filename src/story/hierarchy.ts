import type { Epic } from "@logbook/epic/schema.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { Context, Effect } from "effect"
import { appendStoryIdToEpic, error, repositoryError, validateParentEpic } from "./rules.js"

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")

const HIERARCHY_REFERENCE_UPDATE_LIMIT = 1000

type ValidateHierarchyLinkInput = {
  readonly epicId: string
  readonly storyId: string
}

type ValidateHierarchyLinkResult = {
  readonly epic: Epic
}

export const validateHierarchyLink = (
  input: ValidateHierarchyLinkInput
): Effect.Effect<ToolResult<ValidateHierarchyLinkResult>, never, EpicRepositoryShape> =>
  Effect.gen(function* () {
    const epicRepo = (yield* EpicRepository) as unknown as EpicRepositoryShape
    const parentEpic = yield* Effect.either(epicRepo.get(input.epicId))
    if (parentEpic._tag === "Left") {
      return repositoryError(parentEpic.left)
    }

    const parentEpicRule = validateParentEpic(parentEpic.right, input.epicId)
    if (parentEpicRule) {
      return parentEpicRule
    }

    const nextEpic = appendStoryIdToEpic(parentEpic.right, input.storyId)
    if (nextEpic.storyIds.length > HIERARCHY_REFERENCE_UPDATE_LIMIT) {
      return hierarchyViolation("epic", input.epicId)
    }

    return {
      ok: true,
      data: {
        epic: nextEpic,
      },
    }
  })

const hierarchyViolation = (field: "epic" | "story", id: string): ToolResult<never> =>
  error("hierarchy_violation", `${field} ${id} exceeds the hierarchy reference update limit`, {
    [`${field}Id`]: id,
    limit: HIERARCHY_REFERENCE_UPDATE_LIMIT,
  })
