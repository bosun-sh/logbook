import type { ToolResult } from "@logbook/shared/result.js"
import type { TaskEstimate } from "@logbook/shared/schema/value-objects.js"
import { TaskEstimateSchema } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { error } from "./comments.js"
import { TaskRepository } from "./ports.js"
import { type Task, TaskSchema } from "./schema.js"

const VALID_FIBONACCI = [1, 2, 3, 5, 8, 13, 21] as const
const MAX_PREDICTED_KTOKENS = 64
const MAX_RATIONALE_BYTES = 4096
const textEncoder = new TextEncoder()

export type EstimateTaskInput = {
  readonly id?: string | undefined
  readonly predictedKTokens: number
  readonly complexity: TaskEstimate["complexity"] | string
  readonly confidence?: TaskEstimate["confidence"] | undefined
  readonly rationale?: string | undefined
}

type EstimateTaskResult = {
  readonly estimate: TaskEstimate
  readonly task?: Task | undefined
}

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

export const defaultTaskEstimate = (input: EstimateTaskInput): ToolResult<TaskEstimate> => {
  const validationError = validateEstimateInput(input)
  if (validationError !== null) {
    return validationError
  }

  const fibonacci = nearestFibonacci(input.predictedKTokens)
  const estimate: TaskEstimate = {
    predictedKTokens: input.predictedKTokens,
    complexity: input.complexity as TaskEstimate["complexity"],
    fibonacci,
    confidence: input.confidence ?? "low",
    ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
  }

  const parsed = TaskEstimateSchema.safeParse(estimate)
  if (!parsed.success) {
    return error("validation_error", parsed.error.issues[0]?.message ?? "validation failed", {
      issues: parsed.error.issues.map((issue) => issue.message),
    })
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

export const estimateTask = (
  input: EstimateTaskInput
): Effect.Effect<ToolResult<EstimateTaskResult>, never, TaskRepository | Clock.Clock> =>
  Effect.gen(function* () {
    const estimate = defaultTaskEstimate(input)
    if (!estimate.ok) {
      return estimate
    }

    if (input.id === undefined) {
      return {
        ok: true,
        data: {
          estimate: estimate.data,
        },
      }
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const task = yield* Effect.either(repo.findById(input.id))
    if (task._tag === "Left") {
      return repositoryError(task.left)
    }

    const now = yield* nowIso()
    const updatedTaskCandidate = {
      ...task.right,
      updatedAt: now,
      estimate: estimate.data,
    }

    const parsed = TaskSchema.safeParse(updatedTaskCandidate)
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
        estimate: estimate.data,
        task: parsed.data,
      },
    }
  })

const validateEstimateInput = (input: EstimateTaskInput): ToolResult<never> | null => {
  if (!Number.isFinite(input.predictedKTokens) || !Number.isInteger(input.predictedKTokens)) {
    return error("validation_error", "predictedKTokens must be an integer", {
      predictedKTokens: input.predictedKTokens,
    })
  }

  if (input.predictedKTokens <= 0) {
    return error("validation_error", "predictedKTokens must be positive", {
      predictedKTokens: input.predictedKTokens,
    })
  }

  if (input.predictedKTokens > MAX_PREDICTED_KTOKENS) {
    return error("validation_error", "predictedKTokens must be at most 64", {
      predictedKTokens: input.predictedKTokens,
      maxPredictedKTokens: MAX_PREDICTED_KTOKENS,
    })
  }

  if (!isTaskEstimateComplexity(input.complexity)) {
    return error("validation_error", "complexity is required", {
      complexity: input.complexity,
    })
  }

  if (input.confidence !== undefined && !isTaskEstimateConfidence(input.confidence)) {
    return error("validation_error", "confidence must be low, medium, or high", {
      confidence: input.confidence,
    })
  }

  if (input.rationale !== undefined) {
    const rationaleBytes = textEncoder.encode(input.rationale).length
    if (rationaleBytes > MAX_RATIONALE_BYTES) {
      return error("validation_error", `rationale exceeds ${MAX_RATIONALE_BYTES} bytes`, {
        maxBytes: MAX_RATIONALE_BYTES,
        actualBytes: rationaleBytes,
      })
    }
  }

  return null
}

const isTaskEstimateComplexity = (
  value: EstimateTaskInput["complexity"]
): value is TaskEstimate["complexity"] =>
  value === "trivial" ||
  value === "small" ||
  value === "medium" ||
  value === "large" ||
  value === "complex"

const isTaskEstimateConfidence = (
  value: EstimateTaskInput["confidence"]
): value is TaskEstimate["confidence"] => value === "low" || value === "medium" || value === "high"

const nearestFibonacci = (value: number): TaskEstimate["fibonacci"] => {
  let nearest: TaskEstimate["fibonacci"] = VALID_FIBONACCI[0] as TaskEstimate["fibonacci"]
  let minDistance = Math.abs(value - nearest)

  for (const candidate of VALID_FIBONACCI) {
    const distance = Math.abs(value - candidate)
    if (distance < minDistance || (distance === minDistance && candidate > nearest)) {
      nearest = candidate
      minDistance = distance
    }
  }

  return nearest
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
