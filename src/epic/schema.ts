import {
  AssignmentSchema,
  EntityMetaSchema,
  ExternalLinkRefSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { z } from "zod"

export const EpicSchema = EntityMetaSchema.extend({
  kind: z.literal("epic"),
  title: TitleSchema,
  description: z.string(),
  outcome: z.string(),
  status: z.enum(["backlog", "active", "paused", "done", "canceled"]),
  owner: AssignmentSchema.optional(),
  storyIds: z.array(z.string().min(1)),
  contextEntryIds: z.array(z.string().min(1)),
  externalLinks: z.array(ExternalLinkRefSchema),
}).strict()

export type Epic = z.infer<typeof EpicSchema>
