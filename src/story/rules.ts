import type { Epic } from "@logbook/epic/schema.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { TitleSchema } from "@logbook/shared/schema/value-objects.js"
import type { Story } from "./schema.js"

export const DEFAULT_STORY_LIST_LIMIT = 200

export type StoryListFilters = {
  readonly epicId?: string | undefined
  readonly status?: Story["status"] | undefined
}

export type StoryDeleteOptions = {
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

export const compareStoriesForList = (left: Story, right: Story): number => {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }

  return left.id.localeCompare(right.id)
}

export const normalizeStoryListLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_STORY_LIST_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_STORY_LIST_LIMIT
  }

  return Math.min(limit, DEFAULT_STORY_LIST_LIMIT)
}

export const matchesStoryListFilters = (story: Story, filters: StoryListFilters): boolean =>
  (filters.epicId === undefined || story.epicId === filters.epicId) &&
  (filters.status === undefined || story.status === filters.status)

export const validateCreateStoryInput = (input: {
  readonly epicId: unknown
  readonly title: unknown
  readonly description: unknown
  readonly userValue: unknown
}): ToolResult<never> | null => {
  if (typeof input.epicId !== "string" || input.epicId.length === 0) {
    return validationError("epicId must not be empty", { field: "epicId" })
  }

  const title = TitleSchema.safeParse(input.title)
  if (!title.success) {
    return validationError(title.error.issues[0]?.message ?? "validation failed", {
      issues: title.error.issues.map((issue) => issue.message),
    })
  }

  if (typeof input.description !== "string") {
    return validationError("description must be a string", { field: "description" })
  }

  if (typeof input.userValue !== "string") {
    return validationError("userValue must be a string", { field: "userValue" })
  }

  return null
}

export const validateUpdateStoryInput = (input: {
  readonly title?: unknown
  readonly description?: unknown
  readonly userValue?: unknown
  readonly status?: unknown
}): ToolResult<never> | null => {
  if (input.title !== undefined) {
    const title = TitleSchema.safeParse(input.title)
    if (!title.success) {
      return validationError(title.error.issues[0]?.message ?? "validation failed", {
        issues: title.error.issues.map((issue) => issue.message),
      })
    }
  }

  if (input.description !== undefined && typeof input.description !== "string") {
    return validationError("description must be a string", { field: "description" })
  }

  if (input.userValue !== undefined && typeof input.userValue !== "string") {
    return validationError("userValue must be a string", { field: "userValue" })
  }

  if (input.status !== undefined && !isStoryStatus(input.status)) {
    return validationError("status must be a valid story status", { field: "status" })
  }

  return null
}

export const validateParentEpic = (epic: Epic, epicId: string): ToolResult<never> | null => {
  if (epic.deletedAt !== undefined) {
    return error("hierarchy_violation", `epic ${epicId} is deleted`, { epicId })
  }

  return null
}

export const appendStoryIdToEpic = (epic: Epic, storyId: string): Epic => ({
  ...epic,
  storyIds: epic.storyIds.includes(storyId) ? [...epic.storyIds] : [...epic.storyIds, storyId],
})

export const validateStoryDelete = (
  _story: Story,
  _options: StoryDeleteOptions = {}
): ToolResult<never> | null => null

export const error = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  },
})

export const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => error("validation_error", message, details)

export const repositoryError = (
  cause: unknown,
  fallbackMessage = "repository operation failed"
): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )

    const id =
      typeof tagged.id === "string"
        ? tagged.id
        : typeof tagged.storyId === "string"
          ? tagged.storyId
          : typeof tagged.epicId === "string"
            ? tagged.epicId
            : typeof tagged.taskId === "string"
              ? tagged.taskId
              : undefined

    return error(
      String(tagged._tag),
      typeof tagged.message === "string" ? tagged.message : fallbackMessage,
      id === undefined || Object.hasOwn(details, "id") ? details : { ...details, id }
    )
  }

  return error("storage_error", fallbackMessage)
}

const isStoryStatus = (value: unknown): value is Story["status"] =>
  value === "backlog" ||
  value === "ready" ||
  value === "in_progress" ||
  value === "done" ||
  value === "canceled"
