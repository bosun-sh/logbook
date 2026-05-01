import { Effect } from "effect"
import { estimateFromKTokens } from "../domain/kTokens.js"
import { selectAssignedModel } from "../domain/model-selection.js"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface CreateTaskInput {
  project: string
  milestone: string
  title: string
  definition_of_done: string[]
  test_cases: string[]
  description: string
  predictedKTokens: number
  priority?: number
}

/**
 * Creates a new task in `backlog` status.
 * Validates all fields, stores assignment metadata, and derives a Fibonacci estimation
 * from predictedKTokens.
 */
export const createTask = (
  input: CreateTaskInput,
  sessionId: string
): Effect.Effect<Task, TaskError, TaskRepository> => {
  // Validate required string fields
  const requiredStringFields: Array<keyof CreateTaskInput> = [
    "project",
    "milestone",
    "title",
    "description",
  ]

  for (const field of requiredStringFields) {
    if (typeof input[field] !== "string" || input[field] === "") {
      return Effect.fail({
        _tag: "validation_error" as const,
        message: `${field} is required`,
      })
    }
  }

  if (!Array.isArray(input.definition_of_done) || input.definition_of_done.length === 0) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "definition_of_done is required",
    })
  }

  if (input.definition_of_done.some((entry) => entry === "")) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "definition_of_done entries must be non-empty",
    })
  }

  if (!Array.isArray(input.test_cases)) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "test_cases is required",
    })
  }

  if (input.test_cases.some((entry) => entry === "")) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "test_cases entries must be non-empty",
    })
  }

  // Validate predictedKTokens is defined and a number
  if (input.predictedKTokens === undefined || input.predictedKTokens === null) {
    return Effect.fail({
      _tag: "validation_error" as const,
      message: "predictedKTokens is required",
    })
  }

  // Derive Fibonacci estimation from kTokens
  return Effect.flatMap(estimateFromKTokens(input.predictedKTokens), (estimation) => {
    const id = crypto.randomUUID()
    const task: Task = {
      project: input.project,
      milestone: input.milestone,
      id,
      title: input.title,
      definition_of_done: input.definition_of_done,
      test_cases: input.test_cases,
      description: input.description,
      assigned_session: sessionId,
      assigned_model: selectAssignedModel(input.predictedKTokens),
      estimation,
      comments: [],
      status: "backlog" as const,
      priority: input.priority ?? 0,
    }

    return Effect.flatMap(TaskRepository, (repo) => repo.save(task)).pipe(Effect.map(() => task))
  })
}
