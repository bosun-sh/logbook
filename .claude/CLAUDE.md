# logbook

File-system kanban board for autonomous AI agents. Tracks tasks across a structured lifecycle so agents and humans share a single source of truth without context bloat.

## Stack

- **Runtime**: Bun / TypeScript
- **Effect system**: Effect.ts — all async operations and errors modeled as `Effect<A, E, R>`
- **Architecture**: hexagonal (ports & adapters), vertical slices per domain concept (`task`, `hook`)
- **Validation**: Zod at every system boundary (MCP input, filesystem reads)
- **Persistence**: JSONL — one task per line, append-only writes, full file scan for reads

## Core Types

```ts
type Status = 'backlog' | 'todo' | 'need_info' | 'blocked' | 'in_progress' | 'pending_review' | 'done'

type Comment = {
  id: string
  timestamp: Date
  title: string
  content: string
  reply: string   // populated when responding to a need_info comment
  kind: 'need_info' | 'regular'  // drives the reply cycle
}

type Agent = {
  id: string        // session_id assigned by the server on connection
  title: string
  description: string
}

type Task = {
  project: string
  milestone: string
  id: string
  title: string
  definition_of_done: string
  description: string
  estimation: number  // fibonacci number derived from predictedKTokens at creation time
  comments: Comment[]
  assignee?: Agent          // optional — set when a session claims the task
  status: Status
  in_progress_since?: Date  // set on entry to in_progress; drives FIFO in current_task
  priority: number          // integer ≥ 0; higher = more urgent; defaults to 0
}
```

## MCP Tools

| Tool | Signature | Notes |
|------|-----------|-------|
| `list_tasks` | `(status: Status \| '*') => Task[]` | defaults to `in_progress` |
| `current_task` | `() => Task` | highest-priority in_progress task for the current session |
| `update_task` | `(id, new_status, comment, sessionId) => void` | triggers lifecycle hooks; sessionId injected server-side; pass comment `id` + `reply` to close a `need_info` cycle |
| `create_task` | `(input: CreateTaskInput, sessionId) => Task` | creates task in `backlog`; input requires `predictedKTokens` (server derives Fibonacci `estimation`) |
| `edit_task` | `(id, updates: EditTaskInput) => Task` | edits mutable fields without status change; accepts optional `predictedKTokens` to re-derive estimation |

Each MCP session is a distinct agent instance. The server assigns a `session_id` on connection and uses it to scope `current_task` — callers never pass an agent ID explicitly.

## Hooks System

Hooks execute before or after task lifecycle events. They are **stateless** — execute and forget.

**Built-in hooks:**
- `task.status_changed` → `need_info`: notifies the user with the blocking comment
- `task.status_changed` → `pending_review`: spawns a reviewer sub-agent and creates a review task
- Second task moved to `in_progress`: requires a justification comment before proceeding

**Custom hooks** live under `hooks/<name>/` with two required files:

```
hooks/
└── example_hook/
    ├── config.yml   # required
    └── script.ts    # any executable language
```

Minimal `config.yml`:
```yaml
event: task.status_changed
condition: "new_status == 'need_info'"  # optional JS-like expression
timeout_ms: 5000                         # optional, default 5000
```

## Project Constitution

@rules/tigerstyle.md
@rules/functional-core.md
@rules/negative-space.md
@rules/dry.md
@rules/solid.md
@rules/clean-code.md
@rules/developer-experience.md
@rules/quality-gates.md
