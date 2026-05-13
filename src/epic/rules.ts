import type { ToolResult } from "@logbook/shared/result.js"
import { AssignmentSchema, TitleSchema } from "@logbook/shared/schema/value-objects.js"
import type { Epic } from "./schema.js"

export const DEFAULT_EPIC_LIST_LIMIT = 200

export type EpicListFilters = {
  readonly status?: Epic["status"] | undefined
  readonly ownerId?: string | undefined
}

export type EpicDeleteOptions = {
  readonly force?: boolean | undefined
  readonly cascade?: boolean | undefined
}

export const compareEpicsForList = (left: Epic, right: Epic): number => {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt)
  }

  return left.id.localeCompare(right.id)
}

export const normalizeEpicListLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_EPIC_LIST_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_EPIC_LIST_LIMIT
  }

  return Math.min(limit, DEFAULT_EPIC_LIST_LIMIT)
}

export const matchesEpicListFilters = (epic: Epic, filters: EpicListFilters): boolean =>
  (filters.status === undefined || epic.status === filters.status) &&
  (filters.ownerId === undefined || epic.owner?.id === filters.ownerId)

export const validateCreateEpicInput = (input: {
  readonly title: string
  readonly description: string
  readonly outcome: string
  readonly owner?: unknown
  readonly storyIds?: unknown
  readonly contextEntryIds?: unknown
}): ToolResult<never> | null => {
  const title = TitleSchema.safeParse(input.title)
  if (!title.success) {
    return validationError(title.error.issues[0]?.message ?? "validation failed", {
      issues: title.error.issues.map((issue) => issue.message),
    })
  }

  if (typeof input.description !== "string") {
    return validationError("description must be a string", { field: "description" })
  }

  if (typeof input.outcome !== "string") {
    return validationError("outcome must be a string", { field: "outcome" })
  }

  if (input.owner !== undefined) {
    const owner = AssignmentSchema.safeParse(input.owner)
    if (!owner.success) {
      return validationError(owner.error.issues[0]?.message ?? "validation failed", {
        issues: owner.error.issues.map((issue) => issue.message),
      })
    }
  }

  const storyIdsError = validateStringArray(input.storyIds, "storyIds")
  if (storyIdsError) {
    return storyIdsError
  }

  const contextEntryIdsError = validateStringArray(input.contextEntryIds, "contextEntryIds")
  if (contextEntryIdsError) {
    return contextEntryIdsError
  }

  return null
}

export const validateUpdateEpicInput = (input: {
  readonly title?: unknown
  readonly description?: unknown
  readonly outcome?: unknown
  readonly status?: unknown
  readonly owner?: unknown
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

  if (input.outcome !== undefined && typeof input.outcome !== "string") {
    return validationError("outcome must be a string", { field: "outcome" })
  }

  if (input.status !== undefined && !isEpicStatus(input.status)) {
    return validationError("status must be a valid epic status", { field: "status" })
  }

  if (input.owner !== undefined) {
    const owner = AssignmentSchema.safeParse(input.owner)
    if (!owner.success) {
      return validationError(owner.error.issues[0]?.message ?? "validation failed", {
        issues: owner.error.issues.map((issue) => issue.message),
      })
    }
  }

  return null
}

export const validateEpicDelete = (
  _epic: Epic,
  _options: EpicDeleteOptions = {}
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

const validateStringArray = (value: unknown, field: string): ToolResult<never> | null => {
  if (value === undefined) {
    return null
  }

  if (!Array.isArray(value)) {
    return validationError(`${field} must be an array`, { field })
  }

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    if (typeof entry !== "string" || entry.length === 0) {
      return validationError(`${field} entries must be non-empty strings`, {
        field,
        index,
      })
    }
  }

  return null
}

const isEpicStatus = (value: unknown): value is Epic["status"] =>
  value === "backlog" ||
  value === "active" ||
  value === "paused" ||
  value === "done" ||
  value === "canceled"
