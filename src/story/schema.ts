import {
  EntityMetaSchema,
  ExternalLinkRefSchema,
  TitleSchema,
} from "@logbook/shared/schema/value-objects.js"
import { z } from "zod"

export const StorySchema = EntityMetaSchema.extend({
  kind: z.literal("story"),
  epicId: z.string().min(1),
  title: TitleSchema,
  description: z.string(),
  userValue: z.string(),
  status: z.enum(["backlog", "ready", "in_progress", "done", "canceled"]),
  taskIds: z.array(z.string().min(1)),
  contextEntryIds: z.array(z.string().min(1)),
  externalLinks: z.array(ExternalLinkRefSchema),
}).strict()

export type Story = z.infer<typeof StorySchema>
