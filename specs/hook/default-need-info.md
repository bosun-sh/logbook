---
id: hook/default-need-info
layer: hook
status: draft
depends_on: [hook/ports, hook/hook-executor]
test_file: tests/e2e/hooks/default-need-info.test.ts
source_file: hooks/need-info-notify/script.ts
module_path: n/a
priority: 2
---

# Default Hook: need_info Notification

## Purpose
Built-in hook that notifies the user when a task transitions to `need_info`, printing the blocking comment to stdout so the human operator sees it.

## Signature
This is a hook script, not a TypeScript function. It is registered as a built-in `HookConfig`.

```ts
// Built-in config (registered in HookRunner factory or server bootstrap)
const needInfoConfig: HookConfig = {
  event:     "task.status_changed",
  condition: "new_status == 'need_info'",
  script:    "hooks/need-info-notify/script.ts",
  timeout_ms: 5000,
}
```

```
hooks/
└── need-info-notify/
    ├── config.yml
    └── script.ts
```

### config.yml
```yaml
event: task.status_changed
condition: "new_status == 'need_info'"
timeout_ms: 5000
```

## Contract

### Trigger Condition
- `new_status === 'need_info'`

### Inputs (via env vars)
| Variable | Value |
|----------|-------|
| `LOGBOOK_TASK_ID` | task id |
| `LOGBOOK_OLD_STATUS` | previous status |
| `LOGBOOK_NEW_STATUS` | `need_info` |
| `LOGBOOK_SESSION_ID` | session id |
| `LOGBOOK_TASKS_FILE` | path to the tasks JSONL file |

### Behaviour
1. Read `LOGBOOK_TASK_ID` from env.
2. Load the task from the JSONL file (using `LOGBOOK_TASKS_FILE` env var).
3. Find the most recent `kind: 'need_info'` comment with an empty reply.
4. Print to stdout:
   ```
   [logbook] Task <task_id> needs info
   Comment: <comment.title>
   > <comment.content>
   ```
5. Exit 0.

### Invariants
- Script MUST be idempotent — running twice for the same event has the same observable output.
- Script MUST exit 0 — non-zero exit is swallowed by `executeHooks` but avoids noise.
- Script MUST NOT modify any task files.

## Implementation Notes
- Script can be written in TypeScript and run with `bun hooks/need-info-notify/script.ts`.
- Use `process.env.LOGBOOK_TASKS_FILE` to locate the tasks file.
- If no blocking comment is found, print a minimal message and exit 0.

## Implementation Checklist
- [ ] Create `hooks/need-info-notify/config.yml`
- [ ] Create `hooks/need-info-notify/script.ts`
- [ ] Script reads env vars, loads task from JSONL, prints notification to stdout
- [ ] Run `bun test tests/e2e/hooks/default-need-info.test.ts`

## Dependencies
- `@logbook/hook/hook-executor` — `HookConfig` type
- `@logbook/hook/ports` — `HookEvent`
