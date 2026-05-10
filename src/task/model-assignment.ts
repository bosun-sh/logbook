import type { ToolResult } from "@logbook/shared/result.js"
import {
  type ModelAssignment,
  ModelAssignmentSchema,
  TaskPhaseSchema,
} from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { error } from "./comments.js"
import { TaskRepository } from "./ports.js"
import { type Task, TaskSchema } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const MAX_MODEL_ID_BYTES = 256
const textEncoder = new TextEncoder()

export type AssignTaskModelInput = {
  readonly id: string
  readonly model: ModelAssignment
}

export type AssignTaskPhaseModelInput = {
  readonly id: string
  readonly phase: string
  readonly model: ModelAssignment
}

export type ResolveTaskModelInput = {
  readonly task: Task
  readonly phase: string
  readonly requireModel?: boolean | undefined
}

type TaskResult = {
  readonly task: Task
}

type TaskPhaseModelResult = {
  readonly task: Task
  readonly resolvedModel: ModelAssignment | undefined
}

export const assignTaskModel = (
  input: AssignTaskModelInput
): Effect.Effect<ToolResult<TaskResult>, never, TaskRepository | Clock.Clock> =>
  Effect.gen(function* () {
    const modelError = validateModelAssignment(input.model)
    if (modelError) {
      return modelError
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const existing = yield* Effect.either(repo.findById(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const now = yield* nowIso()
    const candidate: Task = {
      ...existing.right,
      model: input.model,
      updatedAt: now,
    }

    const parsed = TaskSchema.safeParse(candidate)
    if (!parsed.success) {
      return zodValidationError(parsed.error.issues.map((issue) => issue.message))
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

export const assignTaskPhaseModel = (
  input: AssignTaskPhaseModelInput
): Effect.Effect<ToolResult<TaskPhaseModelResult>, never, TaskRepository | Clock.Clock> =>
  Effect.gen(function* () {
    const phaseError = validateTaskPhase(input.phase)
    if (phaseError) {
      return phaseError
    }

    const modelError = validateModelAssignment(input.model)
    if (modelError) {
      return modelError
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const existing = yield* Effect.either(repo.findById(input.id))
    if (existing._tag === "Left") {
      return repositoryError(existing.left)
    }

    const now = yield* nowIso()
    const nextOverrides = {
      ...existing.right.phaseModelOverrides,
      [input.phase]: input.model,
    }
    const candidate: Task = {
      ...existing.right,
      phaseModelOverrides: nextOverrides,
      updatedAt: now,
    }

    const parsed = TaskSchema.safeParse(candidate)
    if (!parsed.success) {
      return zodValidationError(parsed.error.issues.map((issue) => issue.message))
    }

    const saved = yield* Effect.either(repo.update(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    const resolved = resolveTaskModel({
      task: parsed.data,
      phase: input.phase,
      requireModel: true,
    })
    if (!resolved.ok) {
      return resolved
    }

    return {
      ok: true,
      data: {
        task: parsed.data,
        resolvedModel: resolved.data.resolvedModel,
      },
    }
  })

export const resolveTaskModel = (
  input: ResolveTaskModelInput
): ToolResult<{ readonly resolvedModel: ModelAssignment | undefined }> => {
  const phaseError = validateTaskPhase(input.phase)
  if (phaseError) {
    return phaseError
  }

  const phaseModel =
    input.task.phaseModelOverrides[input.phase as keyof Task["phaseModelOverrides"]]
  const resolvedModel = phaseModel ?? input.task.model
  const modelError = resolvedModel === undefined ? null : validateModelAssignment(resolvedModel)
  if (modelError) {
    return modelError
  }

  if (resolvedModel === undefined && input.requireModel !== false) {
    return error("validation_error", `model resolution is required for phase ${input.phase}`, {
      phase: input.phase,
    })
  }

  return {
    ok: true,
    data: {
      resolvedModel,
    },
  }
}

const validateTaskPhase = (phase: string): ToolResult<never> | null => {
  if (TaskPhaseSchema.safeParse(phase).success) {
    return null
  }

  return error("validation_error", "phase must be one of plan, test, dev, validate", {
    phase,
  })
}

const validateModelAssignment = (model: ModelAssignment): ToolResult<never> | null => {
  const parsed = ModelAssignmentSchema.safeParse(model)
  if (!parsed.success) {
    return zodValidationError(parsed.error.issues.map((issue) => issue.message))
  }

  const byteLength = textEncoder.encode(model.id).length
  if (byteLength > MAX_MODEL_ID_BYTES) {
    return error("validation_error", `model id exceeds ${MAX_MODEL_ID_BYTES} bytes`, {
      field: "model.id",
      maxBytes: MAX_MODEL_ID_BYTES,
      actualBytes: byteLength,
    })
  }

  return null
}

const zodValidationError = (issues: readonly string[]): ToolResult<never> =>
  error("validation_error", issues[0] ?? "validation failed", {
    issues,
  })

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
