#!/usr/bin/env bun
import { createInterface } from "node:readline"
import { Effect, Layer } from "effect"
import { runInit } from "../cli/init.js"
import { executeHooks } from "../hook/hook-executor.js"
import type { HookEvent } from "../hook/ports.js"
import { HookRunner } from "../hook/ports.js"
import { loadHookConfigs } from "../infra/hook-config-loader.js"
import { JsonlTaskRepository } from "../infra/jsonl-task-repository.js"
import { PidSessionRegistry } from "../infra/pid-session-registry.js"
import { TaskRepository } from "../task/ports.js"
import { SessionRegistry } from "../task/session-registry.js"
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
  id?: string | number | null
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
// Agent instructions injected into the MCP initialize response
// ---------------------------------------------------------------------------

const AGENT_INSTRUCTIONS = `\
You are connected to the logbook MCP server. You MUST use it to track all tasks in this session.

## Session start
Call \`current_task\` immediately. If it returns \`no_current_task\`, pick a task from \`list_tasks\` with status \`todo\` and move it to \`in_progress\`, or create a new one with \`create_task\` then advance it: backlog → todo → in_progress.

## Task lifecycle
backlog → todo → in_progress → pending_review → done
Side-exits from in_progress: → need_info (awaiting clarification) or → blocked (external dependency). Return to in_progress once resolved.
Always attach a comment when moving to pending_review.

## Model selection when spawning sub-agents
Base the choice on the \`predictedKTokens\` you set at task creation:

| predictedKTokens | model                      | use for                          |
|------------------|----------------------------|----------------------------------|
| ≤ 5              | claude-haiku-4-5-20251001  | rote / mechanical tasks          |
| 6 – 15           | claude-sonnet-4-6          | moderate complexity              |
| 16+              | claude-sonnet-4-6          | large but well-scoped tasks      |

Override to \`claude-opus-4-6\` regardless of size when the task involves: architectural design, security analysis, creative problem-solving, or complex multi-step reasoning.`

// ---------------------------------------------------------------------------
// MCP tools manifest (static, derived from Zod schemas in each tool file)
// ---------------------------------------------------------------------------

const STATUS_ENUM = [
  "backlog",
  "todo",
  "need_info",
  "blocked",
  "in_progress",
  "pending_review",
  "done",
]

const TOOLS_LIST = [
  {
    name: "list_tasks",
    description: "List tasks, optionally filtered by status. Defaults to in_progress.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          oneOf: [
            { type: "string", enum: STATUS_ENUM },
            { type: "string", enum: ["*"] },
          ],
          description: "Status filter. Use '*' for all tasks. Defaults to 'in_progress'.",
        },
      },
    },
  },
  {
    name: "current_task",
    description:
      "Return the highest-priority in_progress task for this session. Call this at session start before doing any work.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_task",
    description:
      "Create a new task in backlog. Set predictedKTokens to your estimated context use — this drives the Fibonacci estimation and model selection for sub-agents.",
    inputSchema: {
      type: "object",
      required: [
        "project",
        "milestone",
        "title",
        "definition_of_done",
        "description",
        "predictedKTokens",
      ],
      properties: {
        project: { type: "string" },
        milestone: { type: "string" },
        title: { type: "string" },
        definition_of_done: { type: "string" },
        description: { type: "string" },
        predictedKTokens: { type: "number" },
      },
    },
  },
  {
    name: "update_task",
    description:
      "Transition a task's status. Attach a comment when moving to pending_review. Use need_info or blocked for side-exits from in_progress.",
    inputSchema: {
      type: "object",
      required: ["id", "new_status"],
      properties: {
        id: { type: "string" },
        new_status: { type: "string", enum: STATUS_ENUM },
        comment: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              description:
                "Existing comment id — provide only when replying to a need_info comment.",
            },
            title: { type: "string" },
            content: { type: "string" },
            reply: {
              type: "string",
              description: "Reply text — only meaningful when id refers to a need_info comment.",
            },
            kind: { type: "string", enum: ["need_info", "regular"] },
          },
        },
      },
    },
  },
  {
    name: "edit_task",
    description: "Edit mutable fields of a task without changing its status.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        definition_of_done: { type: "string" },
        predictedKTokens: { type: "number" },
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export const startServer = async (): Promise<void> => {
  const tasksFile = process.env.LOGBOOK_TASKS_FILE ?? "./tasks.jsonl"
  const hooksDir = process.env.LOGBOOK_HOOKS_DIR ?? "./hooks"

  const configs = await loadHookConfigs(hooksDir)
  const repo = new JsonlTaskRepository(tasksFile)
  const registry = new PidSessionRegistry(tasksFile)

  const hookRunnerImpl: HookRunner = {
    run: (event: HookEvent) => executeHooks(event, configs),
  }

  const repoLayer: Layer.Layer<TaskRepository> = Layer.succeed(TaskRepository, repo)
  const fullLayer: Layer.Layer<TaskRepository | HookRunner | SessionRegistry> = Layer.merge(
    Layer.merge(repoLayer, Layer.succeed(HookRunner, hookRunnerImpl)),
    Layer.succeed(SessionRegistry, registry)
  )

  const sessionId = newSessionId()
  await Effect.runPromise(registry.register(sessionId, process.pid))

  // ---------------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------------

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "logbook", version: "1.0.0" },
          instructions: AGENT_INSTRUCTIONS,
        }
      case "tools/list":
        return { tools: TOOLS_LIST }
      case "tools/call": {
        const p = params as { name: string; arguments?: unknown }
        const result = await dispatch(p.name, p.arguments ?? {})
        return { content: [{ type: "text", text: JSON.stringify(result) }] }
      }
      case "list_tasks":
        return toolListTasks(params, repoLayer)
      case "current_task":
        return toolCurrentTask(sessionId, fullLayer)
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

    // MCP notifications have no `id` field — do not send a response
    if (!("id" in request)) {
      void dispatch(request.method, request.params ?? {}).catch(() => {})
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
    void Effect.runPromise(registry.deregister(sessionId)).then(() => process.exit(0))
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
// CLI flag handling (before server startup)
// ---------------------------------------------------------------------------

const handleCliFlags = async (): Promise<void> => {
  const arg = process.argv[2]

  if (arg === "init") {
    await runInit()
    process.exit(0)
  }

  if (arg === "--version" || arg === "-v") {
    const pkg = await import("../../package.json", { with: { type: "json" } })
    process.stdout.write(`${pkg.default.version}\n`)
    process.exit(0)
  }

  if (arg === "--help" || arg === "-h") {
    process.stdout.write(`logbook-mcp [command]

Commands:
  init        Scaffold tasks.jsonl, hooks/, and emit client config snippets
  (default)   Start the MCP server (stdio transport)

Options:
  --version   Print version
  --help      Show this help

Environment:
  LOGBOOK_TASKS_FILE   Path to JSONL task store (default: ./tasks.jsonl)
  LOGBOOK_HOOKS_DIR    Directory for hook definitions (default: ./hooks)
  LOGBOOK_LOG_LEVEL    Log level: debug|info|warn|error (default: warn)
`)
    process.exit(0)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

await handleCliFlags()
await startServer()
