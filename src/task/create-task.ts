import { Effect } from "effect"
import { estimateFromKTokens } from "../domain/kTokens.js"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface CreateTaskInput {
  project: string
  milestone: string
  title: string
  definition_of_done: string
  description: string
  predictedKTokens: number
}

/**
 * Creates a new task in `backlog` status assigned to `sessionId`.
 * Validates all fields and derives a Fibonacci estimation from predictedKTokens.
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
    "definition_of_done",
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
      description: input.description,
      estimation,
      comments: [],
      assignee: {
        id: sessionId,
        title: "Agent",
        description: "",
      },
      status: "backlog" as const,
    }

    return Effect.flatMap(TaskRepository, (repo) => repo.save(task)).pipe(Effect.map(() => task))
  })
}
