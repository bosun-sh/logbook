import { Context, type Effect } from "effect"
import type { Task } from "./schema.js"

export type TaskStatus = Task["status"]

export type TaskRepositoryError =
  | { readonly _tag: "not_found"; readonly taskId: string }
  | {
      readonly _tag: "transition_not_allowed"
      readonly from: TaskStatus
      readonly to: TaskStatus
      readonly taskId?: string
    }
  | {
      readonly _tag: "validation_error"
      readonly message: string
      readonly context?: Record<string, unknown>
    }
  | { readonly _tag: "missing_comment"; readonly from?: TaskStatus; readonly to?: TaskStatus }
  | { readonly _tag: "conflict"; readonly taskId: string }
  | { readonly _tag: "no_current_task" }

export interface TaskRepository {
  /** Fails with `not_found` if id is absent. */
  findById(id: string): Effect.Effect<Task, TaskRepositoryError>
  /** Returns empty array when nothing matches; fails with `validation_error` on malformed data. */
  findByStatus(status: TaskStatus | "*"): Effect.Effect<readonly Task[], TaskRepositoryError>
  /** Fails with `conflict` if a task with the same id already exists. */
  save(task: Task): Effect.Effect<void, TaskRepositoryError>
  /** Fails with `not_found` if id is absent. */
  update(task: Task): Effect.Effect<void, TaskRepositoryError>
}

export const TaskRepository = Context.GenericTag<TaskRepository>("TaskRepository")
