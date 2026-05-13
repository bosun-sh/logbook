import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import type {
  Assignment,
  ModelAssignment,
  TaskEstimate,
} from "@logbook/shared/schema/value-objects.js"
import {
  AssignmentSchema,
  DefinitionOfDoneSchema,
  ModelAssignmentSchema,
  TaskEstimateSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import type { Story } from "@logbook/story/schema.js"
import { type Clock, Context, Effect } from "effect"
import { error, validatePriority } from "./comments.js"
import { attachTaskHierarchy } from "./hierarchy.js"
import { TaskRepository } from "./ports.js"
import { type Task, TaskSchema } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

export type CreateTaskInput = {
  readonly title: string
  readonly description: string
  readonly definitionOfReady?: string | undefined
  readonly definitionOfDone: string
  readonly project: string
  readonly milestone: string
  readonly priority?: number | undefined
  readonly epicId?: string | undefined
  readonly storyId?: string | undefined
  readonly assignee?: Assignment | undefined
  readonly sessionId?: string | undefined
  readonly model?: ModelAssignment | undefined
  readonly estimate?: TaskEstimate | undefined
}

type CreateTaskResult = {
  readonly task: Task
}

const DEFAULT_ESTIMATE: TaskEstimate = {
  predictedKTokens: 0,
  complexity: "trivial",
  fibonacci: 1,
  confidence: "low",
}

export const createTask = (
  input: CreateTaskInput
): Effect.Effect<
  ToolResult<CreateTaskResult>,
  never,
  TaskRepository | StoryRepositoryShape | Clock.Clock
> =>
  Effect.gen(function* () {
    const validationError = validateCreateTaskInput(input)
    if (validationError) {
      return validationError
    }

    const now = yield* nowIso()
    const taskCandidate = {
      id: createId("task"),
      schemaVersion: "2" as const,
      kind: "task" as const,
      createdAt: now,
      updatedAt: now,
      project: input.project,
      milestone: input.milestone,
      title: input.title,
      description: input.description,
      ...(input.definitionOfReady === undefined
        ? {}
        : { definitionOfReady: input.definitionOfReady }),
      definitionOfDone: input.definitionOfDone,
      status: "backlog" as const,
      priority: input.priority ?? 0,
      phaseModelOverrides: {},
      estimate: input.estimate ?? DEFAULT_ESTIMATE,
      contextEntryIds: [],
      comments: [],
      externalLinks: [],
      ...(input.epicId === undefined ? {} : { epicId: input.epicId }),
      ...(input.storyId === undefined ? {} : { storyId: input.storyId }),
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.model === undefined ? {} : { model: input.model }),
    }

    const parsed = TaskSchema.safeParse(taskCandidate)
    if (!parsed.success) {
      return zodValidationError(parsed.error.issues.map((issue) => issue.message))
    }

    const hierarchy = yield* attachTaskHierarchy(parsed.data)
    if (!hierarchy.ok) {
      return hierarchy
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const saved = yield* Effect.either(repo.save(hierarchy.data.task))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    if (hierarchy.data.story !== undefined) {
      const storyRepo = (yield* StoryRepository) as unknown as StoryRepositoryShape
      const updatedStory = yield* Effect.either(storyRepo.update(hierarchy.data.story))
      if (updatedStory._tag === "Left") {
        return repositoryError(updatedStory.left)
      }
    }

    return {
      ok: true,
      data: {
        task: hierarchy.data.task,
      },
    }
  })

const validateCreateTaskInput = (input: CreateTaskInput): ToolResult<never> | null => {
  const title = TitleSchema.safeParse(input.title)
  if (!title.success) {
    return zodValidationError(title.error.issues.map((issue) => issue.message))
  }

  const definitionOfDone = DefinitionOfDoneSchema.safeParse(input.definitionOfDone)
  if (!definitionOfDone.success) {
    return zodValidationError(definitionOfDone.error.issues.map((issue) => issue.message))
  }

  if (input.project.length === 0) {
    return error("validation_error", "project must not be empty", { field: "project" })
  }

  if (input.milestone.length === 0) {
    return error("validation_error", "milestone must not be empty", { field: "milestone" })
  }

  if (input.priority !== undefined) {
    const priorityError = validatePriority(input.priority)
    if (priorityError) {
      return priorityError
    }
  }

  if (input.assignee !== undefined) {
    const assignee = AssignmentSchema.safeParse(input.assignee)
    if (!assignee.success) {
      return zodValidationError(assignee.error.issues.map((issue) => issue.message))
    }
  }

  if (input.model !== undefined) {
    const model = ModelAssignmentSchema.safeParse(input.model)
    if (!model.success) {
      return zodValidationError(model.error.issues.map((issue) => issue.message))
    }
  }

  if (input.estimate !== undefined) {
    const estimate = TaskEstimateSchema.safeParse(input.estimate)
    if (!estimate.success) {
      return zodValidationError(estimate.error.issues.map((issue) => issue.message))
    }
  }

  return null
}

const zodValidationError = (issues: readonly string[]): ToolResult<never> =>
  error("validation_error", issues[0] ?? "validation failed", { issues })

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
