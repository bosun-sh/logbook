import type { ToolResult } from "@logbook/shared/result.js"
import { Effect } from "effect"
import { error } from "./comments.js"
import { TaskRepository } from "./ports.js"
import type { Task } from "./schema.js"

type TaskRepositoryShape = {
  findById(id: string): Effect.Effect<Task, unknown>
  findByStatus(status: Task["status"] | "*"): Effect.Effect<readonly Task[], unknown>
  save(task: Task): Effect.Effect<void, unknown>
  update(task: Task): Effect.Effect<void, unknown>
}

export type GetTaskInput = {
  readonly id: string
}

type GetTaskResult = {
  readonly task: Task
}

export const getTask = (
  input: GetTaskInput
): Effect.Effect<ToolResult<GetTaskResult>, never, TaskRepository> =>
  Effect.gen(function* () {
    const repo = (yield* TaskRepository) as unknown as TaskRepositoryShape
    const task = yield* Effect.either(repo.findById(input.id))
    if (task._tag === "Left") {
      return repositoryError(task.left)
    }

    return {
      ok: true,
      data: {
        task: task.right,
      },
    }
  })

const repositoryError = (cause: unknown): ToolResult<never> => {
  if (typeof cause === "object" && cause !== null && "_tag" in cause) {
    const tagged = cause as Record<string, unknown>
    const id =
      typeof tagged.id === "string"
        ? tagged.id
        : typeof tagged.taskId === "string"
          ? tagged.taskId
          : undefined

    return error(
      String(tagged._tag),
      typeof tagged.message === "string" ? tagged.message : "repository operation failed",
      id === undefined ? undefined : { id }
    )
  }

  return error("storage_error", "repository operation failed")
}
