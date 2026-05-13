import type { ContextEntry } from "@logbook/context/schema.js"
import { ContextEntrySchema } from "@logbook/context/schema.js"
import type { Epic } from "@logbook/epic/schema.js"
import { EpicSchema } from "@logbook/epic/schema.js"
import { JsonlRepository } from "@logbook/shared/storage/jsonl-repository.js"
import type { Story } from "@logbook/story/schema.js"
import { StorySchema } from "@logbook/story/schema.js"
import type { TaskRepository as TaskRepositoryPort, TaskStatus } from "@logbook/task/ports.js"
import type { Task } from "@logbook/task/schema.js"
import { TaskSchema } from "@logbook/task/schema.js"
import { Effect } from "effect"
import { resolveWorkspacePaths } from "./storage-layout.js"

type WorkspaceRepositoryOptions = {
  readonly workspaceRoot: string
  readonly initialized?: boolean | undefined
}

export class TaskRepository extends JsonlRepository<Task> {
  constructor(options: WorkspaceRepositoryOptions) {
    super({
      entityName: "task",
      filePath: resolveWorkspacePaths(options.workspaceRoot).tasks,
      schema: TaskSchema,
      initialized: options.initialized,
    })
  }

  asPort(): TaskRepositoryPort {
    return new TaskRepositoryPortAdapter(this)
  }
}

class TaskRepositoryPortAdapter implements TaskRepositoryPort {
  constructor(private readonly store: JsonlRepository<Task>) {}

  findById(
    id: string
  ): Effect.Effect<Task, { readonly _tag: "not_found"; readonly taskId: string }> {
    return Effect.mapError(this.store.get(id), () => ({ _tag: "not_found" as const, taskId: id }))
  }

  findByStatus(status: TaskStatus | "*"): Effect.Effect<readonly Task[], never> {
    return Effect.map(
      Effect.orElseSucceed(this.store.list(), () => [] as readonly Task[]),
      (tasks) => (status === "*" ? tasks : tasks.filter((t) => t.status === status))
    )
  }

  save(task: Task): Effect.Effect<void, { readonly _tag: "conflict"; readonly taskId: string }> {
    return Effect.mapBoth(this.store.create(task), {
      onFailure: () => ({ _tag: "conflict" as const, taskId: task.id }),
      onSuccess: () => undefined,
    })
  }

  update(task: Task): Effect.Effect<void, { readonly _tag: "not_found"; readonly taskId: string }> {
    return Effect.mapBoth(this.store.update(task), {
      onFailure: () => ({ _tag: "not_found" as const, taskId: task.id }),
      onSuccess: () => undefined,
    })
  }
}

export class EpicRepository extends JsonlRepository<Epic> {
  constructor(options: WorkspaceRepositoryOptions) {
    super({
      entityName: "epic",
      filePath: resolveWorkspacePaths(options.workspaceRoot).epics,
      schema: EpicSchema,
      initialized: options.initialized,
    })
  }
}

export class StoryRepository extends JsonlRepository<Story> {
  constructor(options: WorkspaceRepositoryOptions) {
    super({
      entityName: "story",
      filePath: resolveWorkspacePaths(options.workspaceRoot).stories,
      schema: StorySchema,
      initialized: options.initialized,
    })
  }
}

export class ContextRepository extends JsonlRepository<ContextEntry> {
  constructor(options: WorkspaceRepositoryOptions) {
    super({
      entityName: "context entry",
      filePath: resolveWorkspacePaths(options.workspaceRoot).contextEntries,
      schema: ContextEntrySchema,
      initialized: options.initialized,
    })
  }
}

export { JsonlRepository }
