import type { Comment } from "@logbook/shared/schema/value-objects.js"
import type { TaskStatus } from "@logbook/task/ports.js"
import { Context, type Effect } from "effect"

export type { Comment }

export interface HookEvent {
  task_id: string
  old_status: TaskStatus
  new_status: TaskStatus
  comment: Comment | null
  session_id: string
}

export interface HookRunner {
  run(event: HookEvent): Effect.Effect<void, never>
}

export const HookRunner = Context.GenericTag<HookRunner>("HookRunner")
