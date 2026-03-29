# Logbook Hooks — Scaffold & Debug Guide

Hooks execute side effects when task lifecycle events fire. They are stateless: run once, exit, done.

## Directory Layout

```
hooks/
└── <hook-name>/
    ├── config.yml   # required — declares the event, condition, and timeout
    └── script.ts    # required — the executable (any language; bun for .ts)
```

Both files must exist. Missing either disables the hook silently.

## config.yml Fields

```yaml
event: task.status_changed          # required — only supported event today
condition: "new_status == 'done'"   # optional — JS-like expression; omit to always fire
timeout_ms: 5000                     # optional — default 5000; max 30000
```

### Condition Expression Syntax

Conditions are evaluated as JS expressions against a hook event object. Available variables:

| Variable | Type | Description |
|----------|------|-------------|
| `task_id` | string | ID of the task that triggered the event |
| `old_status` | string | Status before the transition |
| `new_status` | string | Status after the transition |
| `session_id` | string | MCP session that made the change |

Examples:
```yaml
condition: "new_status == 'pending_review'"
condition: "old_status == 'in_progress' && new_status == 'done'"
condition: "new_status == 'need_info'"
```

## Environment Variables in script.ts

The hook runtime injects these into the process environment:

| Variable | Description |
|----------|-------------|
| `LOGBOOK_TASK_ID` | ID of the triggering task |
| `LOGBOOK_OLD_STATUS` | Status before transition |
| `LOGBOOK_NEW_STATUS` | Status after transition |
| `LOGBOOK_SESSION_ID` | MCP session ID |
| `LOGBOOK_TASKS_FILE` | Absolute path to tasks.jsonl |

Always guard against empty values and exit 0 on missing data — hooks must not crash the server.

## Minimal Working Template

```typescript
#!/usr/bin/env bun
import { readFile, appendFile } from "node:fs/promises"

const taskId   = process.env['LOGBOOK_TASK_ID']    ?? ''
const dataFile = process.env['LOGBOOK_TASKS_FILE'] ?? './tasks.jsonl'

if (taskId === '') process.exit(0)

// your logic here

process.exit(0)
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — hook ran (or intentionally skipped) |
| non-zero | Hook failed — error is logged; task transition still completes |

Hooks run asynchronously. A failing hook does not roll back the status change.

## Testing a Hook in Isolation

Set the required env vars and run the script directly:

```sh
LOGBOOK_TASK_ID=task-123 \
LOGBOOK_OLD_STATUS=in_progress \
LOGBOOK_NEW_STATUS=pending_review \
LOGBOOK_SESSION_ID=sess-abc \
LOGBOOK_TASKS_FILE=./tasks.jsonl \
bun hooks/<hook-name>/script.ts
```

## Creating a New Hook

1. `mkdir hooks/<hook-name>`
2. Write `config.yml` with the event and optional condition.
3. Write `script.ts` using the template above.
4. Test in isolation with the env vars above.
5. Move a task through the triggering transition to verify end-to-end.

## Built-in Hooks (Reference)

| Hook | Event | Condition | Effect |
|------|-------|-----------|--------|
| `need-info-notify` | `task.status_changed` | `new_status == 'need_info'` | Notifies user with the blocking comment |
| `review-spawn` | `task.status_changed` | `new_status == 'pending_review'` | Creates a review task and spawns reviewer subagent |
