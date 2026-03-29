import { Context, Effect } from "effect"
import type { Status, Comment } from "../domain/types.js"

export interface HookEvent {
  task_id:    string
  old_status: Status
  new_status: Status
  comment:    Comment | null
  session_id: string
}

export interface HookRunner {
  run(event: HookEvent): Effect.Effect<void, never>
}

export const HookRunner = Context.GenericTag<HookRunner>("HookRunner")
