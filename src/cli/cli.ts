#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { createLayer, type LayerConfig } from "../infra/layer.js"
import { taskErrorToMcpError } from "../mcp/error-codes.js"
import { newSessionId } from "../mcp/session.js"
import { toolCreateTask } from "../mcp/tool-create-task.js"
import { toolCurrentTask } from "../mcp/tool-current-task.js"
import { toolEditTask } from "../mcp/tool-edit-task.js"
import { toolListTasks } from "../mcp/tool-list-tasks.js"
import { toolUpdateTask } from "../mcp/tool-update-task.js"
import { runInit } from "./init.js"

const DEFAULT_TASKS_FILE = "./tasks.jsonl"
const DEFAULT_HOOKS_DIR = "./hooks"
const SESSION_FILE = ".logbook-session"

const helpText = `# logbook - File-system kanban board CLI

## SYNOPSIS

    logbook <command> [options]

## DESCRIPTION

Logbook is a file-system kanban board for AI agents. It tracks tasks across a structured
lifecycle so agents and humans share a single source of truth without context bloat.

## COMMANDS

### logbook create-task

Create a new task in backlog. The task is assigned a unique ID and estimated Fibonacci
number based on the predicted context size (predictedKTokens).

Required arguments:
  --project <name>          Project name (e.g., "myproject")
  --milestone <name>       Milestone name (e.g., "v1")
  --title <text>           Task title
  --definition-of-done <text>  What "done" means for this task
  --description <text>     Detailed description
  --predicted-k-tokens <n> Estimated context size in thousands of tokens (drives model selection)

Optional arguments:
  --priority <n>           Priority (higher = more urgent, default: 0)

Example:
  logbook create-task --project myproject --milestone v1 --title "Fix bug" \\
    --definition-of-done "Bug fixed and tested" --description "Details..." \\
    --predicted-k-tokens 3

### logbook list-tasks

List tasks, optionally filtered by status, project, or milestone.

Optional arguments:
  --status <status>    Filter by status (default: "in_progress")
                       Valid values: backlog, todo, need_info, blocked, in_progress,
                       pending_review, done, or "*" for all
  --project <name>     Filter by project name
  --milestone <name>   Filter by milestone name

Examples:
  logbook list-tasks
  logbook list-tasks --status "*"
  logbook list-tasks --status todo --project myproject

### logbook current-task

Return the highest-priority in_progress task for this session. If no task is assigned
to this session, it will claim an unassigned task or transition a todo task to in_progress.

This command automatically claims a task if none is currently assigned to the session.

Example:
  logbook current-task

### logbook update-task

Transition a task's status. Some transitions require a comment.

Required arguments:
  --id <uuid>           Task ID
  --new-status <status>  Target status

Optional arguments:
  --comment-title <text>      Comment title
  --comment-content <text>    Comment body
  --comment-kind <kind>       Comment type: "regular" or "need_info" (default: regular)

Status transitions require a comment in these cases:
  - Transitioning to need_info (must document what info is needed)
  - Transitioning to blocked (must document why blocked)
  - Moving a second task to in_progress (must explain priority)
  - Transitioning to pending_review (should document review request)

Use --comment-title and --comment-content together. To reply to a need_info comment,
include the original comment's ID via the MCP interface.

Examples:
  logbook update-task --id <uuid> --new-status in_progress
  logbook update-task --id <uuid> --new-status pending_review \\
    --comment-title "Review please" --comment-content "Done!"
  logbook update-task --id <uuid> --new-status need_info \\
    --comment-title "Need info" --comment-content "What does X mean?"

### logbook edit-task

Edit mutable fields of a task without changing its status.

Required arguments:
  --id <uuid>           Task ID

Optional arguments:
  --title <text>               New title
  --description <text>         New description
  --definition-of-done <text>  New definition of done
  --predicted-k-tokens <n>     New predicted context size (will recalculate estimation)
  --priority <n>              New priority

Example:
  logbook edit-task --id <uuid> --title "New title"

### logbook init

Initialize the project: create tasks.jsonl, hooks/, AGENTS.md, and CLAUDE.md if they
don't exist. If they exist, append logbook documentation to them.

By default:
- If neither AGENTS.md nor CLAUDE.md exists → creates AGENTS.md and symlinks CLAUDE.md to it
- If only AGENTS.md exists → appends to AGENTS.md
- If only CLAUDE.md exists → appends to CLAUDE.md

Optional arguments:
  --force                Force creation/sync of both files. Appends to existing,
                        creates/symlinks missing. Ensures both files exist.

This command scaffolds the basic structure needed to use logbook.

Examples:
  logbook init
  logbook init --force

## TASK LIFECYCLE

    backlog → todo → in_progress → pending_review → done

Side-exits from in_progress:
  - need_info: task needs clarification (return to in_progress once resolved)
  - blocked: task is blocked by external dependency (return to in_progress once resolved)

## ENVIRONMENT

  LOGBOOK_TASKS_FILE   Path to JSONL task store (default: ./tasks.jsonl)
  LOGBOOK_HOOKS_DIR    Directory for hook definitions (default: ./hooks)
  LOGBOOK_SESSION_ID   Session ID to use (auto-generated if not provided)

## GLOBAL OPTIONS

  --tasks-file <path>   Path to JSONL task store
  --hooks-dir <path>    Directory for hook definitions
  --session <id>        Session ID to use
  --version, -v         Print version
  --help, -h            Show this help

## OUTPUT FORMAT

All commands output JSON to stdout:

  Success:   { "ok": true, ...result }
  Error:     { "ok": false, "error": { "code": <n>, "message": <text>, ... } }

Exit code: 0 on success, 1 on error.
`

interface CliArgs {
  tasksFile: string
  hooksDir: string
  sessionId: string | null
  command: string | null
  commandArgs: Record<string, string>
}

const parseArgs = (): CliArgs => {
  const args = process.argv.slice(2)
  const result: CliArgs = {
    tasksFile: process.env.LOGBOOK_TASKS_FILE ?? DEFAULT_TASKS_FILE,
    hooksDir: process.env.LOGBOOK_HOOKS_DIR ?? DEFAULT_HOOKS_DIR,
    sessionId: process.env.LOGBOOK_SESSION_ID ?? null,
    command: null,
    commandArgs: {},
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === "--tasks-file" && i + 1 < args.length) {
      result.tasksFile = args[i + 1] ?? ""
      i += 2
    } else if (arg === "--hooks-dir" && i + 1 < args.length) {
      result.hooksDir = args[i + 1] ?? ""
      i += 2
    } else if (arg === "--session" && i + 1 < args.length) {
      result.sessionId = args[i + 1] ?? null
      i += 2
    } else if (arg === "--version" || arg === "-v") {
      printVersion()
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
    } else if (arg && !arg.startsWith("-")) {
      result.command = arg
      i++
      while (i < args.length) {
        const cmdArg = args[i]
        if (cmdArg?.startsWith("-") && cmdArg.includes("=")) {
          const [key, ...valueParts] = cmdArg.slice(2).split("=")
          if (key) {
            result.commandArgs[key] = valueParts.join("=")
          }
          i++
        } else if (
          cmdArg?.startsWith("-") &&
          i + 1 < args.length &&
          args[i + 1] &&
          !args[i + 1]?.startsWith("-")
        ) {
          result.commandArgs[cmdArg.slice(2)] = args[i + 1] ?? ""
          i += 2
        } else if (
          cmdArg?.startsWith("-") &&
          (i + 1 >= args.length || args[i + 1]?.startsWith("-"))
        ) {
          result.commandArgs[cmdArg.slice(2)] = "true"
          i++
        } else {
          i++
        }
      }
      break
    } else {
      i++
    }
  }

  return result
}

const printVersion = async (): Promise<void> => {
  const pkg = await import("../../package.json", { with: { type: "json" } })
  console.log(pkg.default.version)
  process.exit(0)
}

const printHelp = (): void => {
  console.log(helpText)
  process.exit(0)
}

const getOrCreateSession = async (explicitSessionId: string | null): Promise<string> => {
  if (explicitSessionId) {
    return explicitSessionId
  }
  try {
    if (existsSync(SESSION_FILE)) {
      const stored = await readFile(SESSION_FILE, "utf8")
      const parsed = JSON.parse(stored)
      if (parsed.sessionId && typeof parsed.sessionId === "string") {
        return parsed.sessionId
      }
    }
  } catch {}
  const newSession = newSessionId()
  await writeFile(SESSION_FILE, JSON.stringify({ sessionId: newSession }), "utf8")
  return newSession
}

const _saveSession = async (sessionId: string): Promise<void> => {
  await writeFile(SESSION_FILE, JSON.stringify({ sessionId }), "utf8")
}

const output = (result: unknown): void => {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const outputError = (error: unknown, _command?: string): void => {
  let code = -32603
  let message = "Internal error"
  let hint = ""
  let extra: Record<string, unknown> = {}

  if (isTaskError(error)) {
    const mcpErr = taskErrorToMcpError(error)
    code = mcpErr.code
    message = mcpErr.message
    extra = mcpErr.data

    const hints: string[] = []

    switch (error._tag) {
      case "not_found":
        hints.push("Use: logbook list-tasks --status '*' to find available tasks")
        hints.push("Use: logbook list-tasks --status <status> to list tasks by status")
        break
      case "transition_not_allowed":
        if (error.from && error.to) {
          hints.push(`Use: logbook update-task --id=${error.taskId} --new-status=<valid-status>`)
          if (error.from === "backlog") {
            hints.push("Note: Tasks must move: backlog → todo → in_progress")
          }
        }
        break
      case "validation_error":
        if (error.message.includes("second task to in_progress")) {
          hints.push(
            "Use: logbook update-task --id=<uuid> --new-status=in_progress --comment-title='...' --comment-content='justification'"
          )
        } else if (error.message.includes("need_info") && error.message.includes("reply")) {
          hints.push("Include a non-empty reply in your comment to proceed")
        }
        break
      case "missing_comment":
        hints.push(
          "Use: logbook update-task --id=<uuid> --new-status=<status> --comment-title='...' --comment-content='...'"
        )
        break
      case "no_current_task":
        hints.push("Use: logbook list-tasks --status=todo to find available tasks")
        hints.push("Use: logbook create-task ... to create a new task")
        break
      case "conflict":
        hints.push(
          "Use a different task ID or check existing tasks with: logbook list-tasks --status='*'"
        )
        break
    }

    if (hints.length > 0) {
      hint = `\n\nHints:\n${hints.map((h) => `  - ${h}`).join("\n")}`
    }
  } else if (error instanceof Error) {
    message = error.message
    if (message.includes("Missing required")) {
      hint = "\n\nRun: logbook <command> --help for usage information"
    }
  }

  const fullMessage = message + hint
  output({ ok: false, error: { code, message: fullMessage, ...extra } })
  process.exit(1)
}

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

const runCommand = async (args: CliArgs): Promise<void> => {
  const sessionId = await getOrCreateSession(args.sessionId)
  const config: LayerConfig = {
    tasksFile: args.tasksFile,
    hooksDir: args.hooksDir,
  }
  const layer = await createLayer(config)

  const dispatch = async (): Promise<unknown> => {
    switch (args.command) {
      case "init": {
        await runInit(process.cwd(), { force: !!args.commandArgs.force })
        return { ok: true }
      }
      case "create-task": {
        const input = {
          project: args.commandArgs.project,
          milestone: args.commandArgs.milestone,
          title: args.commandArgs.title,
          definition_of_done: args.commandArgs["definition-of-done"],
          description: args.commandArgs.description,
          predictedKTokens: parseInt(args.commandArgs["predicted-k-tokens"] ?? "0", 10),
          priority: args.commandArgs.priority ? parseInt(args.commandArgs.priority, 10) : 0,
        }
        if (
          !input.project ||
          !input.milestone ||
          !input.title ||
          !input.definition_of_done ||
          !input.description ||
          !input.predictedKTokens
        ) {
          throw new Error(
            "Missing required arguments: project, milestone, title, definition-of-done, description, predicted-k-tokens"
          )
        }
        return toolCreateTask(input, sessionId, layer)
      }
      case "list-tasks": {
        const input = {
          status: args.commandArgs.status ?? "in_progress",
          project: args.commandArgs.project,
          milestone: args.commandArgs.milestone,
        }
        return toolListTasks(input, layer)
      }
      case "current-task": {
        return toolCurrentTask(sessionId, layer)
      }
      case "update-task": {
        const input: Record<string, unknown> = {
          id: args.commandArgs.id,
          new_status: args.commandArgs["new-status"],
        }
        if (args.commandArgs["comment-title"] || args.commandArgs["comment-content"]) {
          input.comment = {
            title: args.commandArgs["comment-title"] ?? "",
            content: args.commandArgs["comment-content"] ?? "",
            kind: args.commandArgs["comment-kind"] ?? "regular",
          }
        }
        if (!input.id || !input.new_status) {
          throw new Error("Missing required arguments: id, new-status")
        }
        return toolUpdateTask(input, sessionId, layer)
      }
      case "edit-task": {
        const input: Record<string, unknown> = { id: args.commandArgs.id }
        if (args.commandArgs.title) input.title = args.commandArgs.title
        if (args.commandArgs.description) input.description = args.commandArgs.description
        if (args.commandArgs["definition-of-done"])
          input.definition_of_done = args.commandArgs["definition-of-done"]
        if (args.commandArgs["predicted-k-tokens"])
          input.predictedKTokens = parseInt(args.commandArgs["predicted-k-tokens"], 10)
        if (args.commandArgs.priority) input.priority = parseInt(args.commandArgs.priority, 10)
        if (!input.id) {
          throw new Error("Missing required argument: id")
        }
        return toolEditTask(input, layer)
      }
      default:
        throw new Error(`Unknown command: ${args.command ?? "none"}`)
    }
  }

  try {
    const result = await dispatch()
    output({ ok: true, ...(result as object) })
  } catch (err) {
    outputError(err, args.command ?? undefined)
  }
}

const cleanup = async (sessionId: string): Promise<void> => {
  try {
    const tasksFile = process.env.LOGBOOK_TASKS_FILE ?? DEFAULT_TASKS_FILE
    const { PidSessionRegistry } = await import("../infra/pid-session-registry.js")
    const registry = new PidSessionRegistry(tasksFile)
    await Effect.runPromise(registry.deregister(sessionId))
  } catch {}
}

const main = async (): Promise<void> => {
  const args = parseArgs()

  if (!args.command) {
    printHelp()
  }

  const sessionId = await getOrCreateSession(args.sessionId)

  process.on("SIGINT", async () => {
    await cleanup(sessionId)
    process.exit(0)
  })
  process.on("SIGTERM", async () => {
    await cleanup(sessionId)
    process.exit(0)
  })

  await runCommand(args)
}

main()
