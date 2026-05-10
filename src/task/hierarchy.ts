import type { ToolResult } from "@logbook/shared/result.js"
import { error, repositoryError } from "@logbook/story/rules.js"
import type { Story } from "@logbook/story/schema.js"
import { Context, Effect } from "effect"
import type { Task } from "./schema.js"

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const HIERARCHY_REFERENCE_UPDATE_LIMIT = 1000

type AttachTaskHierarchyResult = {
  readonly task: Task
  readonly story?: Story
}

export const attachTaskHierarchy = (
  task: Task
): Effect.Effect<ToolResult<AttachTaskHierarchyResult>, never, StoryRepositoryShape> =>
  Effect.gen(function* () {
    if (task.storyId === undefined) {
      return {
        ok: true,
        data: {
          task,
        },
      }
    }

    const storyRepo = (yield* StoryRepository) as unknown as StoryRepositoryShape
    const parentStory = yield* Effect.either(storyRepo.get(task.storyId))
    if (parentStory._tag === "Left") {
      return repositoryError(parentStory.left)
    }

    if (parentStory.right.deletedAt !== undefined) {
      return error("hierarchy_violation", `story ${task.storyId} is deleted`, {
        storyId: task.storyId,
      })
    }

    if (task.epicId !== undefined && task.epicId !== parentStory.right.epicId) {
      return error("hierarchy_violation", `task epicId must match story ${task.storyId}`, {
        epicId: task.epicId,
        storyId: task.storyId,
        storyEpicId: parentStory.right.epicId,
      })
    }

    const nextTaskIds = parentStory.right.taskIds.includes(task.id)
      ? [...parentStory.right.taskIds]
      : [...parentStory.right.taskIds, task.id]

    if (nextTaskIds.length > HIERARCHY_REFERENCE_UPDATE_LIMIT) {
      return error(
        "hierarchy_violation",
        `story ${task.storyId} exceeds the hierarchy reference update limit`,
        {
          storyId: task.storyId,
          limit: HIERARCHY_REFERENCE_UPDATE_LIMIT,
        }
      )
    }

    return {
      ok: true,
      data: {
        task:
          task.epicId === undefined
            ? {
                ...task,
                epicId: parentStory.right.epicId,
              }
            : task,
        story: {
          ...parentStory.right,
          taskIds: nextTaskIds,
        },
      },
    }
  })
