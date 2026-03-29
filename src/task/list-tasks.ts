import { Effect } from "effect"
import type { Task, Status } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

/**
 * Returns tasks matching the given status, or all tasks when status is '*'.
 * Never fails — returns empty array when nothing matches.
 */
export const listTasks = (
  status: Status | '*',
): Effect.Effect<readonly Task[], never, TaskRepository> =>
  Effect.die(new Error("not implemented"))
