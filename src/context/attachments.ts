import { type Epic, EpicSchema } from "@logbook/epic/schema.js"
import type { ToolResult } from "@logbook/shared/result.js"
import type { ContextAttachment } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Story, StorySchema } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort } from "@logbook/task/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { type Task, TaskSchema } from "@logbook/task/schema.js"
import { type Clock, Context, Effect } from "effect"
import { type ContextEntry, ContextEntrySchema } from "./schema.js"
import { normalizeTopic } from "./topics.js"

type ContextRepositoryShape = {
  create(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  get(id: string): Effect.Effect<ContextEntry, unknown>
  list(): Effect.Effect<readonly ContextEntry[], unknown>
  listAll?(): Effect.Effect<readonly ContextEntry[], unknown>
  update(entry: ContextEntry): Effect.Effect<ContextEntry, unknown>
  tombstone(id: string): Effect.Effect<ContextEntry, unknown>
}

type EpicRepositoryShape = {
  create(epic: Epic): Effect.Effect<Epic, unknown>
  get(id: string): Effect.Effect<Epic, unknown>
  list(): Effect.Effect<readonly Epic[], unknown>
  update(epic: Epic): Effect.Effect<Epic, unknown>
  tombstone(id: string): Effect.Effect<Epic, unknown>
}

type StoryRepositoryShape = {
  create(story: Story): Effect.Effect<Story, unknown>
  get(id: string): Effect.Effect<Story, unknown>
  list(): Effect.Effect<readonly Story[], unknown>
  update(story: Story): Effect.Effect<Story, unknown>
  tombstone(id: string): Effect.Effect<Story, unknown>
}

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

const ContextRepository = Context.GenericTag<ContextRepositoryShape>("ContextRepository")
const EpicRepository = Context.GenericTag<EpicRepositoryShape>("EpicRepository")
const StoryRepository = Context.GenericTag<StoryRepositoryShape>("StoryRepository")

const MAX_ATTACHMENTS_PER_ENTRY = 1000
const MAX_TOPICS_PER_ENTRY = 50

export type ContextAttachmentTarget =
  | {
      readonly type: "epic" | "story" | "task"
      readonly id: string
    }
  | {
      readonly type: "topic"
      readonly name: string
    }

export type AttachContextInput = {
  readonly id: string
  readonly target: ContextAttachmentTarget
}

export type DetachContextInput = {
  readonly id: string
  readonly target: ContextAttachmentTarget
}

type AttachContextResult = {
  readonly contextEntry: ContextEntry
}

type DetachContextResult = {
  readonly contextEntry: ContextEntry
}

type EntityTargetRecord =
  | { readonly kind: "epic"; readonly entity: Epic }
  | { readonly kind: "story"; readonly entity: Story }
  | { readonly kind: "task"; readonly entity: Task }

export const normalizeAttachmentTarget = (
  target: ContextAttachmentTarget
): ToolResult<ContextAttachment> => {
  if (target.type === "topic") {
    const normalized = normalizeTopic(target.name)
    if (!normalized.ok) {
      return validationError(normalized.error.message, {
        ...(normalized.error.details ?? {}),
        field: "target.name",
      })
    }

    return {
      ok: true,
      data: {
        kind: "topic",
        id: normalized.data,
      },
    }
  }

  const id = target.id.trim()
  if (id.length === 0) {
    return validationError("target.id must not be empty", { field: "target.id" })
  }

  return {
    ok: true,
    data: {
      kind: target.type,
      id,
    },
  }
}

export const attachContext = (
  input: AttachContextInput
): Effect.Effect<
  ToolResult<AttachContextResult>,
  never,
  | ContextRepositoryShape
  | EpicRepositoryShape
  | StoryRepositoryShape
  | TaskRepositoryPort
  | Clock.Clock
> =>
  Effect.gen(function* () {
    const normalized = normalizeAttachmentTarget(input.target)
    if (!normalized.ok) {
      return normalized
    }

    const contextRepo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const existingContext = yield* Effect.either(contextRepo.get(input.id))
    if (existingContext._tag === "Left") {
      return repositoryError(existingContext.left)
    }

    const target = yield* resolveTarget(normalized.data)
    if (!target.ok) {
      return target
    }

    if (hasAttachment(existingContext.right, normalized.data)) {
      return {
        ok: true,
        data: {
          contextEntry: existingContext.right,
        },
      }
    }

    if (existingContext.right.attachedTo.length >= MAX_ATTACHMENTS_PER_ENTRY) {
      return validationError("attachedTo exceeds 1000 items", {
        field: "attachedTo",
        maxItems: MAX_ATTACHMENTS_PER_ENTRY,
      })
    }

    if (
      normalized.data.kind === "topic" &&
      countTopicAttachments(existingContext.right) >= MAX_TOPICS_PER_ENTRY
    ) {
      return validationError("topics exceeds 50 items", {
        field: "topics",
        maxItems: MAX_TOPICS_PER_ENTRY,
      })
    }

    const now = yield* nowIso()
    const nextContext = parseContextEntry({
      ...existingContext.right,
      updatedAt: now,
      attachedTo: [...existingContext.right.attachedTo, normalized.data],
      topics: [...existingContext.right.topics],
      relevanceHints: [...existingContext.right.relevanceHints],
    })
    if (!nextContext.ok) {
      return nextContext
    }

    const savedContext = yield* Effect.either(contextRepo.update(nextContext.data))
    if (savedContext._tag === "Left") {
      return repositoryError(savedContext.left)
    }

    if (target.data !== null) {
      const updatedTarget = yield* updateTargetAttachment(
        target.data,
        existingContext.right.id,
        now,
        "attach"
      )
      if (!updatedTarget.ok) {
        return updatedTarget
      }
    }

    return {
      ok: true,
      data: {
        contextEntry: nextContext.data,
      },
    }
  })

export const detachContext = (
  input: DetachContextInput
): Effect.Effect<
  ToolResult<DetachContextResult>,
  never,
  | ContextRepositoryShape
  | EpicRepositoryShape
  | StoryRepositoryShape
  | TaskRepositoryPort
  | Clock.Clock
> =>
  Effect.gen(function* () {
    const normalized = normalizeAttachmentTarget(input.target)
    if (!normalized.ok) {
      return normalized
    }

    const contextRepo = (yield* ContextRepository) as unknown as ContextRepositoryShape
    const existingContext = yield* Effect.either(contextRepo.get(input.id))
    if (existingContext._tag === "Left") {
      return repositoryError(existingContext.left)
    }

    const target = yield* resolveTarget(normalized.data)
    if (!target.ok) {
      return target
    }

    if (!hasAttachment(existingContext.right, normalized.data)) {
      return {
        ok: true,
        data: {
          contextEntry: existingContext.right,
        },
      }
    }

    const now = yield* nowIso()
    const nextContext = parseContextEntry({
      ...existingContext.right,
      updatedAt: now,
      attachedTo: existingContext.right.attachedTo.filter(
        (attachment) => !sameAttachment(attachment, normalized.data)
      ),
      topics: [...existingContext.right.topics],
      relevanceHints: [...existingContext.right.relevanceHints],
    })
    if (!nextContext.ok) {
      return nextContext
    }

    const savedContext = yield* Effect.either(contextRepo.update(nextContext.data))
    if (savedContext._tag === "Left") {
      return repositoryError(savedContext.left)
    }

    if (target.data !== null) {
      const updatedTarget = yield* updateTargetAttachment(
        target.data,
        existingContext.right.id,
        now,
        "detach"
      )
      if (!updatedTarget.ok) {
        return updatedTarget
      }
    }

    return {
      ok: true,
      data: {
        contextEntry: nextContext.data,
      },
    }
  })

const resolveTarget = (
  target: ContextAttachment
): Effect.Effect<
  ToolResult<EntityTargetRecord | null>,
  never,
  EpicRepositoryShape | StoryRepositoryShape | TaskRepositoryPort
> =>
  Effect.gen(function* () {
    if (target.kind === "topic") {
      return {
        ok: true,
        data: null,
      }
    }

    if (target.kind === "epic") {
      const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
      const epic = yield* Effect.either(repo.get(target.id))
      if (epic._tag === "Left") {
        return repositoryError(epic.left)
      }

      return {
        ok: true,
        data: {
          kind: "epic",
          entity: epic.right,
        },
      }
    }

    if (target.kind === "story") {
      const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
      const story = yield* Effect.either(repo.get(target.id))
      if (story._tag === "Left") {
        return repositoryError(story.left)
      }

      return {
        ok: true,
        data: {
          kind: "story",
          entity: story.right,
        },
      }
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const task = yield* Effect.either(repo.findById(target.id))
    if (task._tag === "Left") {
      return repositoryError(task.left)
    }

    return {
      ok: true,
      data: {
        kind: "task",
        entity: task.right,
      },
    }
  })

const updateTargetAttachment = (
  target: EntityTargetRecord,
  contextEntryId: string,
  now: string,
  mode: "attach" | "detach"
): Effect.Effect<
  ToolResult<void>,
  never,
  EpicRepositoryShape | StoryRepositoryShape | TaskRepositoryPort
> =>
  Effect.gen(function* () {
    if (target.kind === "epic") {
      const repo = (yield* EpicRepository) as unknown as EpicRepositoryShape
      const nextIds = updateContextEntryIds(target.entity.contextEntryIds, contextEntryId, mode)
      if (arraysEqual(nextIds, target.entity.contextEntryIds)) {
        return { ok: true, data: undefined }
      }

      const parsed = EpicSchema.safeParse({
        ...target.entity,
        updatedAt: now,
        storyIds: [...target.entity.storyIds],
        contextEntryIds: nextIds,
        externalLinks: [...target.entity.externalLinks],
      })
      if (!parsed.success) {
        return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
      }

      const saved = yield* Effect.either(repo.update(parsed.data))
      if (saved._tag === "Left") {
        return repositoryError(saved.left)
      }

      return { ok: true, data: undefined }
    }

    if (target.kind === "story") {
      const repo = (yield* StoryRepository) as unknown as StoryRepositoryShape
      const nextIds = updateContextEntryIds(target.entity.contextEntryIds, contextEntryId, mode)
      if (arraysEqual(nextIds, target.entity.contextEntryIds)) {
        return { ok: true, data: undefined }
      }

      const parsed = StorySchema.safeParse({
        ...target.entity,
        updatedAt: now,
        taskIds: [...target.entity.taskIds],
        contextEntryIds: nextIds,
        externalLinks: [...target.entity.externalLinks],
      })
      if (!parsed.success) {
        return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
      }

      const saved = yield* Effect.either(repo.update(parsed.data))
      if (saved._tag === "Left") {
        return repositoryError(saved.left)
      }

      return { ok: true, data: undefined }
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const nextIds = updateContextEntryIds(target.entity.contextEntryIds, contextEntryId, mode)
    if (arraysEqual(nextIds, target.entity.contextEntryIds)) {
      return { ok: true, data: undefined }
    }

    const parsed = TaskSchema.safeParse({
      ...target.entity,
      updatedAt: now,
      contextEntryIds: nextIds,
      comments: [...target.entity.comments],
      externalLinks: [...target.entity.externalLinks],
    })
    if (!parsed.success) {
      return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
    }

    const saved = yield* Effect.either(repo.update(parsed.data))
    if (saved._tag === "Left") {
      return repositoryError(saved.left)
    }

    return { ok: true, data: undefined }
  })

const hasAttachment = (entry: ContextEntry, target: ContextAttachment): boolean =>
  entry.attachedTo.some((attachment) => sameAttachment(attachment, target))

const sameAttachment = (left: ContextAttachment, right: ContextAttachment): boolean =>
  left.kind === right.kind && left.id === right.id

const countTopicAttachments = (entry: ContextEntry): number =>
  entry.attachedTo.filter((attachment) => attachment.kind === "topic").length

const updateContextEntryIds = (
  current: readonly string[],
  contextEntryId: string,
  mode: "attach" | "detach"
): string[] => {
  if (mode === "attach") {
    return current.includes(contextEntryId) ? [...current] : [...current, contextEntryId]
  }

  return current.filter((id) => id !== contextEntryId)
}

const arraysEqual = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((entry, index) => Object.is(entry, right[index]))

const parseContextEntry = (candidate: ContextEntry): ToolResult<ContextEntry> => {
  const parsed = ContextEntrySchema.safeParse(candidate)
  if (!parsed.success) {
    return validationErrorFromIssues(parsed.error.issues.map((issue) => issue.message))
  }

  return {
    ok: true,
    data: parsed.data,
  }
}

const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})

const validationErrorFromIssues = (issues: readonly string[]): ToolResult<never> =>
  validationError(issues[0] ?? "validation failed", {
    issues,
  })

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const details = Object.fromEntries(
      Object.entries(tagged).filter(([key]) => key !== "_tag" && key !== "message")
    )
    const id =
      typeof tagged.id === "string"
        ? tagged.id
        : typeof tagged.taskId === "string"
          ? tagged.taskId
          : undefined

    return {
      ok: false,
      error: {
        code: String(tagged._tag),
        message:
          typeof tagged.message === "string" ? tagged.message : "repository operation failed",
        ...(id === undefined || Object.hasOwn(details, "id")
          ? { details }
          : { details: { ...details, id } }),
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "storage_error",
      message: "repository operation failed",
    },
  }
}
