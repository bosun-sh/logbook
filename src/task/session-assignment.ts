import { createId } from "@logbook/shared/ids.js"
import type { ToolResult } from "@logbook/shared/result.js"
import type { Assignment } from "@logbook/shared/schema/value-objects.js"
import { AssignmentSchema } from "@logbook/shared/schema/value-objects.js"
import { nowIso } from "@logbook/shared/time.js"
import { type Clock, Effect } from "effect"
import { SessionLivenessPort } from "../workspace/session-liveness.js"
import { error, validateCommentContent } from "./comments.js"
import { TaskRepository } from "./ports.js"
import type { Task } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

export type AssignTaskSessionInput = {
  readonly id: string
  readonly sessionId: string
  readonly assignee?: Assignment | undefined
  readonly reason?: string | undefined
}

export type ClearTaskSessionInput = {
  readonly id: string
  readonly reason?: string | undefined
}

type TaskResult = {
  readonly task: Task
}

export const assignTaskSession = (
  input: AssignTaskSessionInput
): Effect.Effect<
  ToolResult<TaskResult>,
  never,
  TaskRepository | SessionLivenessPort | Clock.Clock
> =>
  Effect.gen(function* () {
    const validationError = validateAssignmentInput(input.assignee)
    if (validationError) {
      return validationError
    }

    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const now = yield* nowIso()
    const taskResult = yield* Effect.either(repo.findById(input.id))
    if (taskResult._tag === "Left") {
      return repositoryError(taskResult.left)
    }

    const task = taskResult.right
    const currentSessionId = task.sessionId
    const nextAssignee = normalizeAssignee(task, input.assignee, input.sessionId)
    const assignmentChange = currentSessionId !== input.sessionId
    const reassignment = currentSessionId !== undefined && assignmentChange

    if (reassignment) {
      const alive = yield* isSessionAlive(currentSessionId)
      if (alive) {
        return assignmentConflict(task.id, currentSessionId)
      }
    }

    const auditComment = reassignment
      ? buildAssignmentAuditComment(task, input.sessionId, input.reason, now)
      : undefined
    if (auditComment && !auditComment.ok) {
      return auditComment
    }

    if (!assignmentChange && assigneeEqual(task.assignee, nextAssignee)) {
      return {
        ok: true,
        data: {
          task,
        },
      }
    }

    const nextTask: Task = {
      ...task,
      sessionId: input.sessionId,
      updatedAt: now,
      ...(nextAssignee === undefined ? {} : { assignee: nextAssignee }),
      ...(auditComment?.ok
        ? {
            comments: [...task.comments, auditComment.data],
          }
        : {}),
    }

    const updateResult = yield* Effect.either(repo.update(nextTask))
    if (updateResult._tag === "Left") {
      return repositoryError(updateResult.left)
    }

    return {
      ok: true,
      data: {
        task: nextTask,
      },
    }
  })

export const clearTaskSession = (
  input: ClearTaskSessionInput
): Effect.Effect<
  ToolResult<TaskResult>,
  never,
  TaskRepository | SessionLivenessPort | Clock.Clock
> =>
  Effect.gen(function* () {
    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const now = yield* nowIso()
    const taskResult = yield* Effect.either(repo.findById(input.id))
    if (taskResult._tag === "Left") {
      return repositoryError(taskResult.left)
    }

    const task = taskResult.right
    if (task.sessionId === undefined) {
      return {
        ok: true,
        data: {
          task,
        },
      }
    }

    const auditComment = buildClearAuditComment(task, input.reason, now)
    if (!auditComment.ok) {
      return auditComment
    }

    const nextTask: Task = {
      ...task,
      sessionId: undefined,
      updatedAt: now,
      comments: [...task.comments, auditComment.data],
    }

    const updateResult = yield* Effect.either(repo.update(nextTask))
    if (updateResult._tag === "Left") {
      return repositoryError(updateResult.left)
    }

    return {
      ok: true,
      data: {
        task: nextTask,
      },
    }
  })

const validateAssignmentInput = (assignee: Assignment | undefined): ToolResult<never> | null => {
  if (assignee === undefined) {
    return null
  }

  const parsed = AssignmentSchema.safeParse(assignee)
  if (!parsed.success) {
    return zodValidationError(parsed.error.issues.map((issue) => issue.message))
  }

  return null
}

const normalizeAssignee = (
  task: Task,
  assignee: Assignment | undefined,
  sessionId: string
): Assignment | undefined => {
  if (assignee !== undefined) {
    return {
      ...assignee,
      id: sessionId,
    }
  }

  return task.assignee
}

const assigneeEqual = (left: Assignment | undefined, right: Assignment | undefined): boolean => {
  if (left === right) {
    return true
  }

  if (left === undefined || right === undefined) {
    return false
  }

  return (
    left.id === right.id && left.title === right.title && left.description === right.description
  )
}

const buildAssignmentAuditComment = (
  task: Task,
  nextSessionId: string,
  reason: string | undefined,
  now: string
): ToolResult<Task["comments"][number]> => {
  const previousSessionId = task.sessionId ?? "unassigned"
  const previousAssignee = task.assignee?.title
  const lines = [`Session reassigned from ${previousSessionId} to ${nextSessionId}.`]
  if (previousAssignee !== undefined) {
    lines.push(`Previous assignee: ${previousAssignee}.`)
  }
  if (reason !== undefined && reason.length > 0) {
    lines.push(`Reason: ${reason}.`)
  }

  const content = lines.join("\n")
  const contentError = validateCommentContent(content)
  if (contentError) {
    return contentError
  }

  return {
    ok: true,
    data: {
      id: createId("comment"),
      title: "Session reassignment",
      content,
      kind: "sync",
      createdAt: now,
      replies: [],
    },
  }
}

const buildClearAuditComment = (
  task: Task,
  reason: string | undefined,
  now: string
): ToolResult<Task["comments"][number]> => {
  const lines = [`Session cleared from ${task.sessionId ?? "unassigned"}.`]
  if (task.assignee?.title !== undefined) {
    lines.push(`Previous assignee: ${task.assignee.title}.`)
  }
  if (reason !== undefined && reason.length > 0) {
    lines.push(`Reason: ${reason}.`)
  }

  const content = lines.join("\n")
  const contentError = validateCommentContent(content)
  if (contentError) {
    return contentError
  }

  return {
    ok: true,
    data: {
      id: createId("comment"),
      title: "Session cleared",
      content,
      kind: "sync",
      createdAt: now,
      replies: [],
    },
  }
}

const isSessionAlive = (sessionId: string): Effect.Effect<boolean, never, SessionLivenessPort> =>
  Effect.flatMap(SessionLivenessPort, (port) => port.isAlive(sessionId))

const zodValidationError = (issues: readonly string[]): ToolResult<never> =>
  error("validation_error", issues[0] ?? "validation failed", { issues })

const assignmentConflict = (id: string, sessionId: string): ToolResult<never> =>
  error("assignment_conflict", `task ${id} is already assigned to live session ${sessionId}`, {
    id,
    sessionId,
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
