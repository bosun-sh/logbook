import { Effect } from "effect"
import type { Task, Status, TaskError } from "../domain/types.js"
import type { TaskRepository } from "../task/ports.js"

/**
 * JSONL-backed TaskRepository.
 * Each line is a JSON-serialized Task.
 * Reads scan the full file; writes are append-only for save, full-rewrite for update.
 */
export class JsonlTaskRepository implements TaskRepository {
  constructor(private readonly filePath: string) {}

  findById(_id: string): Effect.Effect<Task, TaskError> {
    return Effect.die(new Error("not implemented"))
  }

  findByStatus(_status: Status | '*'): Effect.Effect<readonly Task[], never> {
    return Effect.die(new Error("not implemented"))
  }

  save(_task: Task): Effect.Effect<void, TaskError> {
    return Effect.die(new Error("not implemented"))
  }

  update(_task: Task): Effect.Effect<void, TaskError> {
    return Effect.die(new Error("not implemented"))
  }
}
