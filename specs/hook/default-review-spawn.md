---
id: hook/default-review-spawn
layer: hook
status: draft
depends_on: [task/update-task, task/ports]
test_file: tests/e2e/hooks/default-review-spawn.test.ts
source_file: hooks/review-spawn/script.ts
module_path: n/a
priority: 2
---

# Default Hook: Review Spawn

## Purpose
Built-in hook that fires when a task transitions to `pending_review`. Creates a review task (`id = "review-<original_id>"`, status=`todo`) and spawns a reviewer sub-agent to evaluate the work.

## Location
```
hooks/
└── review-spawn/
    ├── config.yml
    └── script.ts
```

### config.yml
```yaml
event: task.status_changed
condition: "new_status == 'pending_review'"
timeout_ms: 30000
```

## Contract

### Trigger Condition
- `new_status === 'pending_review'`

### Inputs (via env vars)
| Variable | Value |
|----------|-------|
| `LOGBOOK_TASK_ID` | original task id |
| `LOGBOOK_OLD_STATUS` | previous status |
| `LOGBOOK_NEW_STATUS` | `pending_review` |
| `LOGBOOK_SESSION_ID` | session id |
| `LOGBOOK_TASKS_FILE` | path to tasks.jsonl |
| `REVIEWER_AGENT_URL` | optional — remote reviewer MCP endpoint |

### Behaviour
1. Read `LOGBOOK_TASK_ID` and `LOGBOOK_TASKS_FILE` from env.
2. Load the original task from the JSONL file.
3. Compute review task id: `"review-" + task.id`.
4. Check if a task with that id already exists in the file (idempotency).
5. If it does NOT exist:
   a. Create review task with:
      - `id`: `"review-<original_id>"`
      - `status`: `todo`
      - `title`: `"Review: <original task title>"`
      - `description`: `"Review the implementation of task <original_id>"`
      - `definition_of_done`: `"Reviewer approved or requested changes"`
      - `project`, `milestone`: same as original task
      - `estimation`: `1`
      - `assignee`: a reviewer agent (see reviewer config)
      - `comments`: `[]`
   b. Append the review task to the JSONL file.
6. Spawn reviewer sub-agent (see `flows/review-agent-config.md` for modes).
7. Exit 0.

### Idempotency
- If `"review-<original_id>"` already exists in the file, skip task creation and skip spawning.
- This prevents duplicate reviews if the hook fires twice.

### Invariants
- Review task creation is atomic with the idempotency check (read-then-append under single-writer assumption).
- The reviewer agent is spawned AFTER the review task is persisted.
- Script MUST exit 0 regardless of reviewer spawn outcome.

## Scenarios
```gherkin
Feature: Review spawn hook

  Scenario: pending_review triggers review task creation
    Given task "t-1" transitions to pending_review
    When the hook fires
    Then a task with id "review-t-1" and status "todo" exists in the file

  Scenario: idempotent — second fire skips creation
    Given "review-t-1" already exists
    When the hook fires again for task "t-1"
    Then no duplicate task is created
    And script exits 0

  Scenario: reviewer agent is spawned after task creation
    When the hook fires
    Then a reviewer sub-agent is spawned
```

## Implementation Notes
- Reviewer agent spawning: if `REVIEWER_AGENT_URL` is set, send MCP request to that URL; otherwise spawn a new Claude Code subprocess in the same repo pointing at the same `tasks.jsonl`.
- See `flows/review-agent-config.md` for full reviewer spawning details.
- `estimation: 1` is a valid Fibonacci number — no validation needed for the review task.
- **Hexagonal trade-off (MVP)**: This script writes directly to the JSONL file, bypassing `TaskRepository`. This is an accepted MVP simplification. Post-MVP, built-in hooks should call domain functions directly instead of writing to the file.

## Implementation Checklist
- [ ] Create `hooks/review-spawn/config.yml`
- [ ] Create `hooks/review-spawn/script.ts`
- [ ] Implement idempotent review task creation and reviewer spawning
- [ ] Run `bun test tests/e2e/hooks/default-review-spawn.test.ts`

## Dependencies
- `@logbook/hook/hook-executor` — `HookConfig`
- `@logbook/infra/jsonl-task-repository` — for reading/writing tasks
- `flows/review-agent-config` — reviewer spawning logic
