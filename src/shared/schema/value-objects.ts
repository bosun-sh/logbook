import { z } from "zod"

const textEncoder = new TextEncoder()

const byteLength = (value: string): number => textEncoder.encode(value).length

const stringWithByteLimit = (field: string, maxBytes: number) =>
  z.string().superRefine((value, ctx) => {
    if (byteLength(value) > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} exceeds ${maxBytes} bytes`,
      })
    }
  })

export const TitleSchema = stringWithByteLimit("title", 512)
export const CommentContentSchema = stringWithByteLimit("content", 65_536)
export const DefinitionOfDoneSchema = stringWithByteLimit("definitionOfDone", 65_536)
export const IsoDateTimeSchema = z.string().datetime({ offset: true })

export const EntityMetaSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal("2"),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    deletedAt: IsoDateTimeSchema.optional(),
  })
  .strict()

export type EntityMeta = z.infer<typeof EntityMetaSchema>

export const AssignmentSchema = z
  .object({
    id: z.string().min(1),
    title: TitleSchema,
    description: z.string().optional(),
  })
  .strict()

export type Assignment = z.infer<typeof AssignmentSchema>

export const ModelAssignmentSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1).optional(),
    reason: z.string().optional(),
  })
  .strict()

export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>

export const TaskPhaseSchema = z.enum(["plan", "test", "dev", "validate"])
export type TaskPhase = z.infer<typeof TaskPhaseSchema>

export const TaskEstimateSchema = z
  .object({
    predictedKTokens: z.number().nonnegative(),
    complexity: z.enum(["trivial", "small", "medium", "large", "complex"]),
    fibonacci: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(5),
      z.literal(8),
      z.literal(13),
      z.literal(21),
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    rationale: z.string().optional(),
  })
  .strict()

export type TaskEstimate = z.infer<typeof TaskEstimateSchema>

export const CommentReplySchema = z
  .object({
    id: z.string().min(1),
    content: CommentContentSchema,
    createdAt: IsoDateTimeSchema,
    author: AssignmentSchema.optional(),
  })
  .strict()

export type CommentReply = z.infer<typeof CommentReplySchema>

export const CommentSchema = z
  .object({
    id: z.string().min(1),
    title: TitleSchema,
    content: CommentContentSchema,
    kind: z.enum(["regular", "need_info", "review", "sync"]),
    createdAt: IsoDateTimeSchema,
    author: AssignmentSchema.optional(),
    replies: z.array(CommentReplySchema),
  })
  .strict()

export type Comment = z.infer<typeof CommentSchema>

export const ContextAttachmentSchema = z
  .object({
    kind: z.enum(["epic", "story", "task", "topic"]),
    id: z.string().min(1),
  })
  .strict()

export type ContextAttachment = z.infer<typeof ContextAttachmentSchema>

export const ExternalProviderSchema = z.string().min(1)
export type ExternalProvider = z.infer<typeof ExternalProviderSchema>

export const ExternalLinkRefSchema = z
  .object({
    provider: ExternalProviderSchema,
    externalLinkId: z.string().min(1),
  })
  .strict()

export type ExternalLinkRef = z.infer<typeof ExternalLinkRefSchema>

export const SyncConflictFieldSchema = z
  .object({
    path: z.string().min(1),
    localValue: z.unknown(),
    remoteValue: z.unknown(),
    baseValue: z.unknown().optional(),
  })
  .strict()

export type SyncConflictField = z.infer<typeof SyncConflictFieldSchema>

export const LocalRecordKindSchema = z.enum(["epic", "story", "task", "context_entry"])
export type LocalRecordKind = z.infer<typeof LocalRecordKindSchema>

export const LocalRecordRefSchema = z
  .object({
    kind: LocalRecordKindSchema,
    id: z.string().min(1),
  })
  .strict()

export type LocalRecordRef = z.infer<typeof LocalRecordRefSchema>

export const TaskPhaseModelOverridesSchema = z
  .object({
    plan: ModelAssignmentSchema.optional(),
    test: ModelAssignmentSchema.optional(),
    dev: ModelAssignmentSchema.optional(),
    validate: ModelAssignmentSchema.optional(),
  })
  .strict()

export type TaskPhaseModelOverrides = z.infer<typeof TaskPhaseModelOverridesSchema>
