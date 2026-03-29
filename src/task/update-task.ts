import { Effect } from "effect"
import type { Status, Comment, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"
import { HookRunner } from "../hook/ports.js"

/**
 * Transitions a task to a new status, optionally attaching or replying to a comment.
 * Enforces transition rules, comment requirements, need_info reply cycle,
 * and concurrent in_progress justification.
 * Fires HookRunner after a successful status change.
 */
export const updateTask = (
  id: string,
  newStatus: Status,
  comment: Comment | null,
  sessionId: string,
): Effect.Effect<void, TaskError, TaskRepository | HookRunner> =>
  Effect.die(new Error("not implemented"))
