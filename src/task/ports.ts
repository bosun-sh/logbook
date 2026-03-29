import { Context, type Effect } from "effect"
import type { Status, Task, TaskError } from "../domain/types.js"

export interface TaskRepository {
  /** Fails with `not_found` if id is absent. */
  findById(id: string): Effect.Effect<Task, TaskError>
  /** Returns empty array when nothing matches; fails with `validation_error` on malformed data. */
  findByStatus(status: Status | "*"): Effect.Effect<readonly Task[], TaskError>
  /** Fails with `conflict` if a task with the same id already exists. */
  save(task: Task): Effect.Effect<void, TaskError>
  /** Fails with `not_found` if id is absent. */
  update(task: Task): Effect.Effect<void, TaskError>
}

export const TaskRepository = Context.GenericTag<TaskRepository>("TaskRepository")
