import { appendFile, readFile, rename, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import type { Status, Task, TaskError } from "../domain/types.js"
import { TaskSchema } from "../domain/types.js"
import type { TaskRepository } from "../task/ports.js"
import { logger } from "./logger.js"

/**
 * JSONL-backed TaskRepository.
 * Each line is a JSON-serialized Task.
 * Reads scan the full file; writes are append-only for save, full-rewrite for update.
 */
export class JsonlTaskRepository implements TaskRepository {
  constructor(private readonly filePath: string) {}

  save(task: Task): Effect.Effect<void, TaskError> {
    return Effect.tryPromise<void, TaskError>({
      try: async () => {
        const content = await readFile(this.filePath, "utf8").catch((e: unknown) => {
          if (isEnoent(e)) return ""
          throw e
        })
        const lines = splitLines(content)
        const conflict = lines.some((line) => {
          try {
            const parsed = JSON.parse(line) as unknown
            return (parsed as { id?: unknown }).id === task.id
          } catch {
            return false
          }
        })
        if (conflict) {
          throw mkTagged<TaskError>({ _tag: "conflict", taskId: task.id })
        }
        await appendFile(this.filePath, `${JSON.stringify(task)}\n`, "utf8")
      },
      catch: (e) => asTaskError(e, task.id),
    })
  }

  update(task: Task): Effect.Effect<void, TaskError> {
    return Effect.tryPromise<void, TaskError>({
      try: async () => {
        const content = await readFile(this.filePath, "utf8").catch((e: unknown) => {
          if (isEnoent(e)) return ""
          throw e
        })
        const lines = splitLines(content)
        let found = false
        const updated = lines.map((line) => {
          try {
            const parsed = JSON.parse(line) as unknown
            if ((parsed as { id?: unknown }).id === task.id) {
              found = true
              return JSON.stringify(task)
            }
          } catch {
            // keep malformed lines as-is
          }
          return line
        })
        if (!found) {
          throw mkTagged<TaskError>({ _tag: "not_found", taskId: task.id })
        }
        const tmpPath = `${this.filePath}.tmp`
        await writeFile(tmpPath, `${updated.join("\n")}\n`, "utf8")
        await rename(tmpPath, this.filePath)
      },
      catch: (e) => asTaskError(e, task.id),
    })
  }

  findById(id: string): Effect.Effect<Task, TaskError> {
    return Effect.tryPromise<Task, TaskError>({
      try: async () => {
        const content = await readFile(this.filePath, "utf8").catch((e: unknown) => {
          if (isEnoent(e)) return ""
          throw e
        })
        const lines = splitLines(content)
        for (const line of lines) {
          const result = parseLine(line)
          if (result._tag === "error") {
            logger.warn("skipping malformed JSONL line", { line, reason: result.reason })
            continue
          }
          if (result.task.id === id) return result.task
        }
        throw mkTagged<TaskError>({ _tag: "not_found", taskId: id })
      },
      catch: (e) => asTaskError(e, id),
    })
  }

  findByStatus(status: Status | "*"): Effect.Effect<readonly Task[], TaskError> {
    return Effect.tryPromise<readonly Task[], TaskError>({
      try: async () => {
        const content = await readFile(this.filePath, "utf8").catch((e: unknown) => {
          if (isEnoent(e)) return ""
          throw e
        })
        const lines = splitLines(content)
        const tasks: Task[] = []
        for (const line of lines) {
          const result = parseLine(line)
          if (result._tag === "error") {
            throw mkTagged<TaskError>({ _tag: "validation_error", message: result.reason })
          }
          if (status === "*" || result.task.status === status) {
            tasks.push(result.task)
          }
        }
        return tasks
      },
      catch: (e) => asTaskError(e, ""),
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

type ParseResult =
  | { readonly _tag: "ok"; readonly task: Task }
  | { readonly _tag: "error"; readonly reason: string }

const parseLine = (line: string): ParseResult => {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch (e) {
    return { _tag: "error", reason: `invalid JSON: ${String(e)}` }
  }
  const result = TaskSchema.safeParse(raw)
  if (!result.success) {
    return { _tag: "error", reason: result.error.message }
  }
  return { _tag: "ok", task: result.data }
}

const splitLines = (content: string): readonly string[] =>
  content.split("\n").filter((l) => l.trim() !== "")

const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT"

/** Carries a typed TaskError through the tryPromise boundary. */
const mkTagged = <E>(value: E): E => value

const asTaskError = (e: unknown, _taskId: string): TaskError => {
  if (isTaskError(e)) return e
  return { _tag: "validation_error", message: String(e) } satisfies TaskError
}

const isTaskError = (e: unknown): e is TaskError =>
  typeof e === "object" && e !== null && typeof (e as { _tag?: unknown })._tag === "string"
