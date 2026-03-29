import type { Status, Task, TaskError } from "@logbook/domain/types.js"
import type { TaskRepository } from "@logbook/task/ports.js"
import { Effect } from "effect"

export class InMemoryTaskRepository implements TaskRepository {
  private readonly store = new Map<string, Task>()

  findById(id: string): Effect.Effect<Task, TaskError> {
    const task = this.store.get(id)
    if (task === undefined) {
      return Effect.fail({ _tag: "not_found" as const, taskId: id })
    }
    return Effect.succeed(task)
  }

  findByStatus(status: Status | "*"): Effect.Effect<readonly Task[], never> {
    const tasks = Array.from(this.store.values())
    if (status === "*") return Effect.succeed(tasks)
    return Effect.succeed(tasks.filter((t) => t.status === status))
  }

  save(task: Task): Effect.Effect<void, TaskError> {
    if (this.store.has(task.id)) {
      return Effect.fail({ _tag: "conflict" as const, taskId: task.id })
    }
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  update(task: Task): Effect.Effect<void, TaskError> {
    if (!this.store.has(task.id)) {
      return Effect.fail({ _tag: "not_found" as const, taskId: task.id })
    }
    this.store.set(task.id, task)
    return Effect.succeed(undefined)
  }

  inspect(): readonly Task[] {
    return Array.from(this.store.values())
  }
}
