import {
  EntityMetaSchema,
  ExternalProviderSchema,
  IsoDateTimeSchema,
  LocalRecordRefSchema,
  SyncConflictFieldSchema,
} from "@logbook/shared/schema/value-objects.js"
import { z } from "zod"

export const SyncEventSchema = EntityMetaSchema.extend({
  kind: z.literal("sync_event"),
  provider: ExternalProviderSchema,
  direction: z.enum(["pull", "push", "status", "resolve"]),
  localRecordId: z.string().min(1).optional(),
  remoteRecordId: z.string().min(1).optional(),
  result: z.enum(["created", "updated", "deleted", "skipped", "conflict", "resolved", "failed"]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict()

export type SyncEvent = z.infer<typeof SyncEventSchema>

export const SyncConflictSchema = EntityMetaSchema.extend({
  kind: z.literal("sync_conflict"),
  provider: ExternalProviderSchema,
  localRecord: LocalRecordRefSchema,
  remoteRecord: z
    .object({
      id: z.string().min(1),
      url: z.string().url().optional(),
    })
    .strict(),
  fields: z.array(SyncConflictFieldSchema),
  status: z.enum(["open", "resolved", "ignored"]),
  resolution: z.enum(["use_local", "use_remote", "manual"]).optional(),
  resolvedAt: IsoDateTimeSchema.optional(),
}).strict()

export type SyncConflict = z.infer<typeof SyncConflictSchema>
