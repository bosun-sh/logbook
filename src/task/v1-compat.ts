import type { ToolResult } from "@logbook/shared/result.js"
import { z } from "zod"
import { type Task, TaskSchema } from "./schema.js"

const V1CommentSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    content: z.string(),
    kind: z.enum(["regular", "need_info"]).default("regular"),
    timestamp: z.string().datetime({ offset: true }),
    reply: z.string().default(""),
  })
  .strict()

const V1TaskSchema = z
  .object({
    id: z.string().min(1),
    project: z.string().min(1),
    milestone: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    definition_of_done: z.array(z.string().min(1)).min(1),
    test_cases: z.array(z.string().min(1)).optional().default([]),
    assigned_session: z.string().optional().default(""),
    assigned_model: z.string().optional().default(""),
    estimation: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(5),
      z.literal(8),
      z.literal(13),
      z.literal(21),
    ]),
    predictedKTokens: z.number().nonnegative().optional().default(0),
    comments: z.array(V1CommentSchema).default([]),
    status: z.enum([
      "backlog",
      "todo",
      "in_progress",
      "need_info",
      "blocked",
      "pending_review",
      "done",
      "canceled",
    ]),
    priority: z.number().int().nonnegative().default(0),
    in_progress_since: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

export type V1Task = z.infer<typeof V1TaskSchema>

export const toV1Task = (task: Task): V1Task => ({
  id: task.id,
  project: task.project,
  milestone: task.milestone,
  title: task.title,
  description: task.description,
  definition_of_done: splitNewlineList(task.definitionOfDone),
  test_cases: splitNewlineList(task.definitionOfReady ?? ""),
  assigned_session: task.sessionId ?? "",
  assigned_model: task.model?.id ?? "",
  estimation: task.estimate.fibonacci,
  predictedKTokens: task.estimate.predictedKTokens,
  comments: task.comments.map((comment) => ({
    id: comment.id,
    title: comment.title,
    content: comment.content,
    kind: comment.kind === "need_info" ? "need_info" : "regular",
    timestamp: comment.createdAt,
    reply: comment.replies[0]?.content ?? "",
  })),
  status: task.status,
  priority: task.priority,
  ...(task.inProgressSince === undefined ? {} : { in_progress_since: task.inProgressSince }),
})

export const fromV1TaskInput = (
  input: unknown,
  options?: { readonly now?: string }
): ToolResult<Task> => {
  const parsedJson = parseJsonIfString(input)
  if (!parsedJson.ok) {
    return parsedJson
  }

  const parsed = V1TaskSchema.safeParse(parsedJson.data)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "validation failed",
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      },
    }
  }

  const now = options?.now ?? new Date().toISOString()
  const v1 = parsed.data
  const definitionOfReady = joinNewlineList(v1.test_cases)
  const migrated: Task = {
    id: v1.id,
    schemaVersion: "2",
    kind: "task",
    createdAt: now,
    updatedAt: now,
    project: v1.project,
    milestone: v1.milestone,
    title: v1.title,
    description: v1.description,
    definitionOfDone: joinNewlineList(v1.definition_of_done),
    ...(definitionOfReady.length === 0 ? {} : { definitionOfReady }),
    status: v1.status,
    priority: v1.priority,
    phaseModelOverrides: {},
    estimate: {
      predictedKTokens: v1.predictedKTokens,
      fibonacci: v1.estimation,
      complexity: estimateComplexity(v1.estimation),
      confidence: "medium",
    },
    comments: v1.comments.map((comment) => ({
      id: comment.id,
      title: comment.title,
      content: comment.content,
      kind: comment.kind,
      createdAt: comment.timestamp,
      replies:
        comment.reply.length === 0
          ? []
          : [
              {
                id: `${comment.id}-reply`,
                content: comment.reply,
                createdAt: comment.timestamp,
              },
            ],
    })),
    contextEntryIds: [],
    externalLinks: [],
    ...(v1.assigned_session.length === 0 ? {} : { sessionId: v1.assigned_session }),
    ...(v1.assigned_model.length === 0 ? {} : { model: { id: v1.assigned_model } }),
    ...(v1.in_progress_since === undefined ? {} : { inProgressSince: v1.in_progress_since }),
  }

  const validated = TaskSchema.safeParse(migrated)
  if (!validated.success) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: validated.error.issues[0]?.message ?? "validation failed",
        details: { issues: validated.error.issues.map((issue) => issue.message) },
      },
    }
  }

  return { ok: true, data: validated.data }
}

const parseJsonIfString = (input: unknown): ToolResult<unknown> => {
  if (typeof input !== "string") {
    return { ok: true, data: input }
  }

  try {
    return { ok: true, data: JSON.parse(input) }
  } catch {
    return {
      ok: false,
      error: {
        code: "malformed_record",
        message: "v1 task record is not valid JSON",
      },
    }
  }
}

const splitNewlineList = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const joinNewlineList = (values: readonly string[]): string => values.join("\n")

const estimateComplexity = (
  fibonacci: 1 | 2 | 3 | 5 | 8 | 13 | 21
): Task["estimate"]["complexity"] => {
  if (fibonacci <= 2) return "trivial"
  if (fibonacci <= 5) return "small"
  if (fibonacci <= 8) return "medium"
  if (fibonacci <= 13) return "large"
  return "complex"
}
