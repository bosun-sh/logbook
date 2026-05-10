import { jsonSchema } from "@bosun-sh/ohtools"

const taskStatusEnum = [
  "backlog",
  "todo",
  "need_info",
  "blocked",
  "in_progress",
  "pending_review",
  "done",
] as const
const epicStatusEnum = ["backlog", "active", "paused", "done", "canceled"] as const
const storyStatusEnum = ["backlog", "ready", "in_progress", "done", "canceled"] as const
const taskPhaseEnum = ["plan", "test", "dev", "validate"] as const
const complexityEnum = ["trivial", "small", "medium", "large", "complex"] as const
const fibonacciEnum = [1, 2, 3, 5, 8, 13, 21] as const
const confidenceEnum = ["low", "medium", "high"] as const
const commentKindEnum = ["regular", "need_info", "review", "sync"] as const
const contextSourceTypeEnum = ["manual", "file", "url", "sync", "task_comment"] as const
const attachmentKindEnum = ["epic", "story", "task", "topic"] as const
const hookEventEnum = [
  "task.status_changed",
  "task.comment_added",
  "sync.completed",
  "sync.conflict_created",
] as const
const syncConflictStatusEnum = ["open", "resolved", "ignored"] as const
const syncConflictResolutionEnum = ["use_local", "use_remote", "manual"] as const
const syncManualResolutionEntityEnum = ["task", "epic", "story", "context"] as const

const idSchema = { type: "string", minLength: 1 } as const
const nonEmptyStringSchema = { type: "string", minLength: 1 } as const
const cursorSchema = { type: "string", minLength: 1 } as const

const assignmentSchema = {
  type: "object",
  properties: {
    id: idSchema,
    title: nonEmptyStringSchema,
    description: { type: "string" },
  },
  required: ["id", "title"],
  additionalProperties: false,
} as const

const modelAssignmentSchema = {
  type: "object",
  properties: {
    id: idSchema,
    provider: nonEmptyStringSchema,
    reason: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
} as const

const estimateSchema = {
  type: "object",
  properties: {
    predictedKTokens: { type: "number", minimum: 0 },
    complexity: { type: "string", enum: [...complexityEnum] },
    fibonacci: { type: "number", enum: [...fibonacciEnum] },
    confidence: { type: "string", enum: [...confidenceEnum] },
    rationale: { type: "string" },
  },
  required: ["predictedKTokens", "complexity", "fibonacci", "confidence"],
  additionalProperties: false,
} as const

const ownerSchema = assignmentSchema

const taskUpdateCommentSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    content: nonEmptyStringSchema,
    kind: { type: "string", enum: [...commentKindEnum] },
    authorId: idSchema,
    replyToCommentId: idSchema,
  },
  required: ["content"],
  additionalProperties: false,
} as const

const contextSourceSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...contextSourceTypeEnum] },
    uri: nonEmptyStringSchema,
    recordId: idSchema,
  },
  required: ["type"],
  additionalProperties: false,
} as const

const contextAttachmentTargetSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "epic" },
        id: idSchema,
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "story" },
        id: idSchema,
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "task" },
        id: idSchema,
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "topic" },
        name: nonEmptyStringSchema,
      },
      required: ["type", "name"],
      additionalProperties: false,
    },
  ],
} as const

const contextAttachmentFilterSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...attachmentKindEnum] },
    id: idSchema,
  },
  required: ["type", "id"],
  additionalProperties: false,
} as const

const syncManualResolutionRecordSchema = {
  type: "object",
  properties: {
    entityType: { type: "string", enum: [...syncManualResolutionEntityEnum] },
    entityId: idSchema,
    fields: {
      type: "object",
      additionalProperties: true,
    },
    rationale: nonEmptyStringSchema,
    resolvedBy: idSchema,
  },
  required: ["entityType", "entityId", "fields", "rationale"],
  additionalProperties: false,
} as const

export const publicToolSchemas = {
  "context.attach": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      target: contextAttachmentTargetSchema,
    },
    required: ["id", "target"],
    additionalProperties: false,
  }),
  "context.create": jsonSchema({
    type: "object",
    properties: {
      title: nonEmptyStringSchema,
      body: nonEmptyStringSchema,
      topics: { type: "array", items: nonEmptyStringSchema },
      source: contextSourceSchema,
      attachedTo: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...attachmentKindEnum] },
            id: idSchema,
          },
          required: ["kind", "id"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "body"],
    additionalProperties: false,
  }),
  "context.delete": jsonSchema({
    type: "object",
    properties: { id: idSchema },
    required: ["id"],
    additionalProperties: false,
  }),
  "context.detach": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      target: contextAttachmentTargetSchema,
    },
    required: ["id", "target"],
    additionalProperties: false,
  }),
  "context.get": jsonSchema({
    type: "object",
    properties: { id: idSchema },
    required: ["id"],
    additionalProperties: false,
  }),
  "context.list": jsonSchema({
    type: "object",
    properties: {
      topic: nonEmptyStringSchema,
      attachedTo: contextAttachmentFilterSchema,
      includeDeleted: { type: "boolean" },
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "context.search": jsonSchema({
    type: "object",
    properties: {
      taskId: idSchema,
      topic: nonEmptyStringSchema,
      query: nonEmptyStringSchema,
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "context.update": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      title: { type: "string" },
      body: { type: "string" },
      topics: { type: "array", items: nonEmptyStringSchema },
      source: contextSourceSchema,
      relevanceHints: { type: "array", items: { type: "string" } },
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "epic.create": jsonSchema({
    type: "object",
    properties: {
      title: nonEmptyStringSchema,
      description: nonEmptyStringSchema,
      outcome: nonEmptyStringSchema,
      owner: ownerSchema,
      storyIds: { type: "array", items: idSchema },
      contextEntryIds: { type: "array", items: idSchema },
    },
    required: ["title", "description", "outcome"],
    additionalProperties: false,
  }),
  "epic.delete": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      force: { type: "boolean" },
      cascade: { type: "boolean" },
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "epic.get": jsonSchema({
    type: "object",
    properties: { id: idSchema },
    required: ["id"],
    additionalProperties: false,
  }),
  "epic.list": jsonSchema({
    type: "object",
    properties: {
      status: { type: "string", enum: [...epicStatusEnum] },
      ownerId: idSchema,
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "epic.update": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      title: { type: "string" },
      description: { type: "string" },
      outcome: { type: "string" },
      status: { type: "string", enum: [...epicStatusEnum] },
      owner: ownerSchema,
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "hook.list": jsonSchema({
    type: "object",
    properties: {
      event: { type: "string", enum: [...hookEventEnum] },
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "hook.run": jsonSchema({
    type: "object",
    properties: {
      hookId: idSchema,
      event: { type: "string", enum: [...hookEventEnum] },
      dryRun: { type: "boolean" },
    },
    required: ["hookId", "event"],
    additionalProperties: false,
  }),
  "plugin.list": jsonSchema({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  "story.create": jsonSchema({
    type: "object",
    properties: {
      epicId: idSchema,
      title: nonEmptyStringSchema,
      description: nonEmptyStringSchema,
      userValue: nonEmptyStringSchema,
    },
    required: ["epicId", "title", "description", "userValue"],
    additionalProperties: false,
  }),
  "story.delete": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      force: { type: "boolean" },
      cascade: { type: "boolean" },
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "story.get": jsonSchema({
    type: "object",
    properties: { id: idSchema },
    required: ["id"],
    additionalProperties: false,
  }),
  "story.list": jsonSchema({
    type: "object",
    properties: {
      epicId: idSchema,
      status: { type: "string", enum: [...storyStatusEnum] },
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "story.update": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      title: { type: "string" },
      description: { type: "string" },
      userValue: { type: "string" },
      status: { type: "string", enum: [...storyStatusEnum] },
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "sync.conflicts.list": jsonSchema({
    type: "object",
    properties: {
      provider: { type: "string", enum: ["linear"] },
      status: { type: "string", enum: [...syncConflictStatusEnum] },
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "sync.conflicts.resolve": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      resolution: { type: "string", enum: [...syncConflictResolutionEnum] },
      manualRecord: syncManualResolutionRecordSchema,
    },
    required: ["id", "resolution"],
    additionalProperties: false,
  }),
  "sync.linear.pull": jsonSchema({
    type: "object",
    properties: {
      since: nonEmptyStringSchema,
      teamId: idSchema,
      projectId: idSchema,
      limit: { type: "integer", minimum: 1 },
      cursor: {
        type: "object",
        properties: {
          providerId: nonEmptyStringSchema,
          cursor: nonEmptyStringSchema,
          pageSize: { type: "integer", minimum: 1 },
        },
        required: ["providerId", "cursor", "pageSize"],
        additionalProperties: false,
      },
      dryRun: { type: "boolean" },
    },
    additionalProperties: false,
  }),
  "sync.linear.push": jsonSchema({
    type: "object",
    properties: {
      taskIds: { type: "array", items: idSchema },
      epicIds: { type: "array", items: idSchema },
      storyIds: { type: "array", items: idSchema },
      teamId: idSchema,
      projectId: idSchema,
      dryRun: { type: "boolean" },
    },
    additionalProperties: false,
  }),
  "sync.linear.status": jsonSchema({
    type: "object",
    properties: {
      checkProvider: { type: "boolean" },
    },
    additionalProperties: false,
  }),
  "task.assign.model": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      model: modelAssignmentSchema,
    },
    required: ["id", "model"],
    additionalProperties: false,
  }),
  "task.assign.phase-model": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      phase: { type: "string", enum: [...taskPhaseEnum] },
      model: modelAssignmentSchema,
    },
    required: ["id", "phase", "model"],
    additionalProperties: false,
  }),
  "task.assign.session": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      sessionId: idSchema,
      assignee: assignmentSchema,
      reason: { type: "string" },
    },
    required: ["id", "sessionId"],
    additionalProperties: false,
  }),
  "task.create": jsonSchema({
    type: "object",
    properties: {
      title: nonEmptyStringSchema,
      description: nonEmptyStringSchema,
      definitionOfDone: nonEmptyStringSchema,
      project: nonEmptyStringSchema,
      milestone: nonEmptyStringSchema,
      priority: { type: "integer" },
      epicId: idSchema,
      storyId: idSchema,
      assignee: assignmentSchema,
      sessionId: idSchema,
      model: modelAssignmentSchema,
      estimate: estimateSchema,
    },
    required: ["title", "description", "definitionOfDone", "project", "milestone"],
    additionalProperties: false,
  }),
  "task.current": jsonSchema({
    type: "object",
    properties: {
      sessionId: idSchema,
      assignee: assignmentSchema,
    },
    required: ["sessionId"],
    additionalProperties: false,
  }),
  "task.edit": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      title: { type: "string" },
      description: { type: "string" },
      definitionOfReady: { type: "string" },
      definitionOfDone: { type: "string" },
      project: { type: "string" },
      milestone: { type: "string" },
      priority: { type: "integer" },
      estimate: estimateSchema,
    },
    required: ["id"],
    additionalProperties: false,
  }),
  "task.estimate": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      predictedKTokens: { type: "number", minimum: 0 },
      complexity: { type: "string", enum: [...complexityEnum] },
      confidence: { type: "string", enum: [...confidenceEnum] },
      rationale: { type: "string" },
    },
    required: ["predictedKTokens", "complexity"],
    additionalProperties: false,
  }),
  "task.get": jsonSchema({
    type: "object",
    properties: { id: idSchema },
    required: ["id"],
    additionalProperties: false,
  }),
  "task.list": jsonSchema({
    type: "object",
    properties: {
      status: {
        oneOf: [{ type: "string", enum: [...taskStatusEnum] }, { const: "*" }],
      },
      project: { type: "string" },
      milestone: { type: "string" },
      epicId: idSchema,
      storyId: idSchema,
      assigneeId: idSchema,
      sessionId: idSchema,
      limit: { type: "integer", minimum: 1 },
      cursor: cursorSchema,
    },
    additionalProperties: false,
  }),
  "task.update": jsonSchema({
    type: "object",
    properties: {
      id: idSchema,
      newStatus: { type: "string", enum: [...taskStatusEnum] },
      comment: taskUpdateCommentSchema,
    },
    required: ["id", "newStatus"],
    additionalProperties: false,
  }),
  "workspace.init": jsonSchema({
    type: "object",
    properties: {
      path: nonEmptyStringSchema,
      force: { type: "boolean" },
      migrateV1: { type: "boolean" },
    },
    additionalProperties: false,
  }),
  "workspace.status": jsonSchema({
    type: "object",
    properties: {
      path: nonEmptyStringSchema,
      checkProvider: { const: false },
    },
    additionalProperties: false,
  }),
} as const
