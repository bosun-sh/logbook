---
id: flows/review-agent-config
layer: flow
status: draft
depends_on: [hook/default-review-spawn, mcp/server]
test_file: none
source_file: n/a
module_path: n/a
priority: 3
---

# Reviewer Agent Configuration

## Purpose
Documents how the reviewer sub-agent is spawned in two modes: same-repo (default) and remote TCP/MCP.

## Modes

### Mode 1: Same-Repo (default)
The reviewer is a new MCP session in the same process, sharing the same `tasks.jsonl` file.

**Trigger**: `REVIEWER_AGENT_URL` is not set.

**Behaviour**:
- `review-spawn` hook spawns a new Claude Code subprocess:
  ```sh
  claude --mcp-config <path-to-mcp-config> --task "review task review-<id>"
  ```
- The subprocess connects to the same MCP server via stdio.
- It receives a new `session_id` and sees `review-<id>` as its `current_task`.
- It shares the same `tasks.jsonl` — reads and writes are visible to the author.

**MCP config for subprocess**:
```json
{
  "mcpServers": {
    "logbook": {
      "command": "bun",
      "args": ["src/mcp/server.ts"],
      "env": {
        "LOGBOOK_TASKS_FILE": "<absolute path>"
      }
    }
  }
}
```

### Mode 2: Remote TCP/MCP
The reviewer is a separate agent reachable over the network.

**Trigger**: `REVIEWER_AGENT_URL` is set (e.g. `http://reviewer-agent:3000/mcp`).

**Behaviour**:
- `review-spawn` hook sends an HTTP POST to `REVIEWER_AGENT_URL`:
  ```json
  {
    "method": "tools/call",
    "params": {
      "name": "start_review",
      "arguments": { "task_id": "review-<id>", "tasks_file": "<path>" }
    }
  }
  ```
- The remote agent connects back to the local MCP server or accesses the shared tasks file.
- Session isolation still applies — remote agent gets its own `session_id`.

## Configuration Reference

| Variable | Mode | Description |
|----------|------|-------------|
| `LOGBOOK_TASKS_FILE` | both | Absolute path to shared tasks.jsonl |
| `REVIEWER_AGENT_URL` | remote | URL of remote reviewer MCP endpoint |
| `LOGBOOK_HOOKS_DIR` | both | Path to hooks directory |

## Invariants
- Both modes result in the reviewer seeing `review-<id>` as their task via `current_task()`.
- The reviewer operates under its own `session_id` — it does NOT inherit the author's session.
- The review task MUST be created before the reviewer is spawned.
- If spawning fails, the review task remains in `todo` for manual pickup.

## Post-MVP Extensions
- Reviewer pool: rotate among multiple configured reviewer endpoints.
- Async review: reviewer polls or receives a webhook rather than being spawned synchronously.
- Auto-close: hook on `review-<id> → done` that automatically moves original task to `done`.
