import {
  ContextAttachmentSchema,
  EntityMetaSchema,
  IsoDateTimeSchema,
  LocalRecordRefSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { z } from "zod"

export const ContextEntrySchema = EntityMetaSchema.extend({
  kind: z.literal("context_entry"),
  title: TitleSchema,
  body: z.string(),
  topics: z.array(z.string()),
  source: z
    .object({
      type: z.enum(["manual", "file", "url", "sync", "task_comment"]),
      uri: z.string().optional(),
      recordId: z.string().min(1).optional(),
    })
    .strict()
    .optional(),
  attachedTo: z.array(ContextAttachmentSchema),
  relevanceHints: z.array(z.string()),
}).strict()

export type ContextEntry = z.infer<typeof ContextEntrySchema>

export const ExternalLinkSchema = EntityMetaSchema.extend({
  kind: z.literal("external_link"),
  provider: z.string().min(1),
  localRecord: LocalRecordRefSchema,
  remoteRecord: z
    .object({
      id: z.string().min(1),
      url: z.string().url().optional(),
      type: z.enum(["issue", "comment", "project", "milestone", "label", "cycle"]),
    })
    .strict(),
  lastSyncedAt: IsoDateTimeSchema.optional(),
  lastSeenRemoteVersion: z.string().min(1).optional(),
  lastPushedLocalVersion: z.string().min(1).optional(),
}).strict()

export type ExternalLink = z.infer<typeof ExternalLinkSchema>
