import {
  AssignmentSchema,
  CommentSchema,
  DefinitionOfDoneSchema,
  EntityMetaSchema,
  ExternalLinkRefSchema,
  ModelAssignmentSchema,
  TaskEstimateSchema,
  TaskPhaseModelOverridesSchema,
  TaskPhaseSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { z } from "zod"

export const TaskSchema = EntityMetaSchema.extend({
  kind: z.literal("task"),
  epicId: z.string().min(1).optional(),
  storyId: z.string().min(1).optional(),
  project: z.string().min(1),
  milestone: z.string().min(1),
  title: TitleSchema,
  description: z.string(),
  definitionOfReady: z.string().optional(),
  definitionOfDone: DefinitionOfDoneSchema,
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
  priority: z.number().int(),
  assignee: AssignmentSchema.optional(),
  sessionId: z.string().min(1).optional(),
  model: ModelAssignmentSchema.optional(),
  phaseModelOverrides: TaskPhaseModelOverridesSchema,
  estimate: TaskEstimateSchema,
  currentPhase: TaskPhaseSchema.optional(),
  contextEntryIds: z.array(z.string().min(1)),
  comments: z.array(CommentSchema),
  inProgressSince: z.string().datetime({ offset: true }).optional(),
  externalLinks: z.array(ExternalLinkRefSchema),
}).strict()

export type Task = z.infer<typeof TaskSchema>
