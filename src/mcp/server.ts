#!/usr/bin/env bun
import { createInterface } from "node:readline"
import { Layer } from "effect"
import { executeHooks } from "../hook/hook-executor.js"
import type { HookEvent } from "../hook/ports.js"
import { HookRunner } from "../hook/ports.js"
import { loadHookConfigs } from "../infra/hook-config-loader.js"
import { JsonlTaskRepository } from "../infra/jsonl-task-repository.js"
import { TaskRepository } from "../task/ports.js"
import { taskErrorToMcpError } from "./error-codes.js"
import { newSessionId } from "./session.js"
import { toolCreateTask } from "./tool-create-task.js"
import { toolCurrentTask } from "./tool-current-task.js"
import { toolEditTask } from "./tool-edit-task.js"
import { toolListTasks } from "./tool-list-tasks.js"
import { toolUpdateTask } from "./tool-update-task.js"

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: string | number | null
  method: string
  params?: unknown
}

interface JsonRpcSuccess {
  jsonrpc: "2.0"
  id: string | number | null
  result: unknown
}

interface JsonRpcError {
  jsonrpc: "2.0"
  id: string | number | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

// ---------------------------------------------------------------------------
// Response helpers (pure)
// ---------------------------------------------------------------------------

const successResponse = (id: string | number | null, result: unknown): JsonRpcSuccess => ({
  jsonrpc: "2.0",
  id,
  result,
})

const errorResponse = (
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcError => ({
  jsonrpc: "2.0",
  id,
  error: data !== undefined ? { code, message, data } : { code, message },
})

const parseError = (id: string | number | null): JsonRpcError =>
  errorResponse(id, -32700, "Parse error")
const methodNotFound = (id: string | number | null, method: string): JsonRpcError =>
  errorResponse(id, -32601, `Method not found: ${method}`)
const internalError = (id: string | number | null, message: string): JsonRpcError =>
  errorResponse(id, -32603, message)

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export const startServer = async (): Promise<void> => {
  const tasksFile = process.env.LOGBOOK_TASKS_FILE ?? "./tasks.jsonl"
  const hooksDir = process.env.LOGBOOK_HOOKS_DIR ?? "./hooks"

  const configs = await loadHookConfigs(hooksDir)
  const repo = new JsonlTaskRepository(tasksFile)

  const hookRunnerImpl: HookRunner = {
    run: (event: HookEvent) => executeHooks(event, configs),
  }

  const repoLayer: Layer.Layer<TaskRepository> = Layer.succeed(TaskRepository, repo)
  const fullLayer: Layer.Layer<TaskRepository | HookRunner> = Layer.merge(
    repoLayer,
    Layer.succeed(HookRunner, hookRunnerImpl)
  )

  const sessionId = newSessionId()

  // ---------------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------------

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case "list_tasks":
        return toolListTasks(params, repoLayer)
      case "current_task":
        return toolCurrentTask(sessionId, repoLayer)
      case "update_task":
        return toolUpdateTask(params, sessionId, fullLayer)
      case "create_task":
        return toolCreateTask(params, sessionId, repoLayer)
      case "edit_task":
        return toolEditTask(params, repoLayer)
      default:
        return Promise.reject(new MethodNotFoundError(method))
    }
  }

  // ---------------------------------------------------------------------------
  // stdio JSON-RPC loop
  // ---------------------------------------------------------------------------

  const rl = createInterface({ input: process.stdin, terminal: false })

  const send = (response: JsonRpcResponse): void => {
    process.stdout.write(`${JSON.stringify(response)}\n`)
  }

  rl.on("line", (line) => {
    const trimmed = line.trim()
    if (trimmed === "") return

    let request: JsonRpcRequest
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      send(parseError(null))
      return
    }

    const id = request.id ?? null

    dispatch(request.method, request.params ?? {})
      .then((result) => {
        send(successResponse(id, result))
      })
      .catch((err: unknown) => {
        if (err instanceof MethodNotFoundError) {
          send(methodNotFound(id, err.method))
          return
        }
        // Task domain errors come through Effect.runPromise rejections
        if (isTaskError(err)) {
          const mcpErr = taskErrorToMcpError(err)
          send(errorResponse(id, mcpErr.code, mcpErr.message, mcpErr.data))
          return
        }
        // Zod parse errors from tool input validation
        if (isZodError(err)) {
          send(errorResponse(id, -32602, "Invalid params", { issues: err.errors }))
          return
        }
        send(internalError(id, String(err)))
      })
  })

  rl.on("close", () => {
    process.exit(0)
  })
}

// ---------------------------------------------------------------------------
// Internal error sentinel
// ---------------------------------------------------------------------------

class MethodNotFoundError extends Error {
  constructor(readonly method: string) {
    super(`Method not found: ${method}`)
  }
}

// ---------------------------------------------------------------------------
// Type narrowing helpers (pure)
// ---------------------------------------------------------------------------

const isTaskError = (e: unknown): e is import("../domain/types.js").TaskError =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as { _tag?: unknown })._tag === "string" &&
  [
    "not_found",
    "transition_not_allowed",
    "validation_error",
    "missing_comment",
    "conflict",
    "no_current_task",
  ].includes((e as { _tag: string })._tag)

interface ZodError {
  errors: unknown[]
}

const isZodError = (e: unknown): e is ZodError =>
  typeof e === "object" &&
  e !== null &&
  Array.isArray((e as { errors?: unknown }).errors) &&
  "name" in (e as object) &&
  (e as { name: string }).name === "ZodError"

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

await startServer()
