import { z } from "zod"

export const StatusSchema = z.enum([
  'backlog',
  'todo',
  'need_info',
  'blocked',
  'in_progress',
  'pending_review',
  'done',
])
export type Status = z.infer<typeof StatusSchema>

export const CommentKindSchema = z.enum(['need_info', 'regular'])
export type CommentKind = z.infer<typeof CommentKindSchema>

export const CommentSchema = z.object({
  id:        z.string().min(1),
  timestamp: z.coerce.date(),
  title:     z.string().min(1),
  content:   z.string(),
  reply:     z.string(),
  kind:      CommentKindSchema,
})
export type Comment = z.infer<typeof CommentSchema>

export const AgentSchema = z.object({
  id:          z.string().min(1),
  title:       z.string().min(1),
  description: z.string(),
})
export type Agent = z.infer<typeof AgentSchema>

export const TaskSchema = z.object({
  project:            z.string().min(1),
  milestone:          z.string().min(1),
  id:                 z.string().min(1),
  title:              z.string().min(1),
  definition_of_done: z.string().min(1),
  description:        z.string().min(1),
  estimation:         z.number().int().positive(),
  comments:           z.array(CommentSchema),
  assignee:           AgentSchema,
  status:             StatusSchema,
  in_progress_since:  z.coerce.date().optional(),
})
export type Task = z.infer<typeof TaskSchema>

// Error tags match Gherkin feature file error names
export type TaskError =
  | { readonly _tag: 'not_found';             readonly taskId: string }
  | { readonly _tag: 'transition_not_allowed'; readonly from: Status; readonly to: Status }
  | { readonly _tag: 'validation_error';       readonly message: string }
  | { readonly _tag: 'missing_comment' }
  | { readonly _tag: 'conflict';               readonly taskId: string }
  | { readonly _tag: 'no_current_task' }
