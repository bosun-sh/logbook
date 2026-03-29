import { Context, Effect } from "effect"
import type { Task, Status, TaskError } from "../domain/types.js"

export interface TaskRepository {
  /** Fails with `not_found` if id is absent. */
  findById(id: string): Effect.Effect<Task, TaskError>
  /** Returns empty array when nothing matches; never fails. */
  findByStatus(status: Status | '*'): Effect.Effect<readonly Task[], never>
  /** Fails with `conflict` if a task with the same id already exists. */
  save(task: Task): Effect.Effect<void, TaskError>
  /** Fails with `not_found` if id is absent. */
  update(task: Task): Effect.Effect<void, TaskError>
}

export const TaskRepository = Context.GenericTag<TaskRepository>("TaskRepository")
