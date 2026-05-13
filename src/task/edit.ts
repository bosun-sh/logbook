import type { ToolResult } from "@logbook/shared/result.js"
import type { TaskEstimate } from "@logbook/shared/schema/value-objects.js"
import {
  DefinitionOfDoneSchema,
  TaskEstimateSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { error, validatePriority } from "./comments.js"
import { TaskRepository } from "./ports.js"
import { type Task, TaskSchema } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

export type EditTaskInput = {
  readonly id: string
  readonly title?: string | undefined
  readonly description?: string | undefined
  readonly definitionOfReady?: string | undefined
  readonly definitionOfDone?: string | undefined
  readonly project?: string | undefined
  readonly milestone?: string | undefined
  readonly priority?: number | undefined
  readonly estimate?: TaskEstimate | undefined
}

type EditTaskResult = {
  readonly task: Task
}

export const editTask = (
  input: EditTaskInput
): Effect.Effect<ToolResult<EditTaskResult>, never, TaskRepository | Clock.Clock> =>
  Effect.gen(function* () {
    const validationError = validateEditTaskInput(input)
    if (validationError) {
      return validationError
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const existing = yield* Effect.either(repo.findById(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const changedFields = Object.keys(input).filter((key) => key !== "id")
    if (changedFields.length === 0) {
      return {
        ok: true,
        data: {
          task: existing.right,
        },
      }
    }

    const now = yield* nowIso()
    const taskCandidate = {
      ...existing.right,
      updatedAt: now,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.definitionOfReady === undefined
        ? {}
        : { definitionOfReady: input.definitionOfReady }),
      ...(input.definitionOfDone === undefined ? {} : { definitionOfDone: input.definitionOfDone }),
      ...(input.project === undefined ? {} : { project: input.project }),
      ...(input.milestone === undefined ? {} : { milestone: input.milestone }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.estimate === undefined ? {} : { estimate: input.estimate }),
    }

    const parsed = TaskSchema.safeParse(taskCandidate)
    if (!parsed.success) {
      return error("validation_error", parsed.error.issues[0]?.message ?? "validation failed", {
        issues: parsed.error.issues.map((issue) => issue.message),
      })
    }

    const saved = yield* Effect.either(repo.update(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return {
      ok: true,
      data: {
        task: parsed.data,
      },
    }
  })

const validateEditTaskInput = (input: EditTaskInput): ToolResult<never> | null => {
  if (input.title !== undefined) {
    const title = TitleSchema.safeParse(input.title)
    if (!title.success) {
      return error("validation_error", title.error.issues[0]?.message ?? "validation failed", {
        issues: title.error.issues.map((issue) => issue.message),
      })
    }
  }

  if (input.definitionOfDone !== undefined) {
    const definitionOfDone = DefinitionOfDoneSchema.safeParse(input.definitionOfDone)
    if (!definitionOfDone.success) {
      return error(
        "validation_error",
        definitionOfDone.error.issues[0]?.message ?? "validation failed",
        {
          issues: definitionOfDone.error.issues.map((issue) => issue.message),
        }
      )
    }
  }

  if (input.priority !== undefined) {
    const priorityError = validatePriority(input.priority)
    if (priorityError) {
      return priorityError
    }
  }

  if (input.project !== undefined && input.project.length === 0) {
    return error("validation_error", "project must not be empty", { field: "project" })
  }

  if (input.milestone !== undefined && input.milestone.length === 0) {
    return error("validation_error", "milestone must not be empty", { field: "milestone" })
  }

  if (input.estimate !== undefined) {
    const estimate = TaskEstimateSchema.safeParse(input.estimate)
    if (!estimate.success) {
      return error("validation_error", estimate.error.issues[0]?.message ?? "validation failed", {
        issues: estimate.error.issues.map((issue) => issue.message),
      })
    }
  }

  return null
}

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )
    return error(
      String(tagged._tag),
      typeof tagged.message === "string" ? tagged.message : "repository operation failed",
      Object.keys(details).length === 0 ? undefined : details
    )
  }

  return error("storage_error", "repository operation failed")
}
