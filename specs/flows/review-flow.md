---
id: flows/review-flow
layer: flow
status: draft
depends_on: [task/update-task, hook/default-review-spawn, mcp/tool-update-task, flows/review-agent-config]
test_file: none
source_file: n/a
module_path: n/a
priority: 2
---

# Flow: pending_review → Reviewer → done

## Purpose
Documents the full sequence from a task being submitted for review through reviewer approval and final completion.

## Sequence

```
Author Agent                   System                        Reviewer Agent
     |                           |                                |
     |-- update_task(→ pending_review)
     |                           |-- persist task                 |
     |                           |-- HookRunner.run               |
     |                           |-- hook: review-spawn           |
     |                           |   1. create "review-<id>" task (todo)
     |                           |   2. spawn reviewer agent  --> (connects via MCP)
     |<-- { ok: true }           |                                |
     |                           |                   current_task() → review-<id>
     |                           |                                |
     |                           |        [reviewer inspects work, reads original task]
     |                           |                                |
     |                           |<-- update_task("review-<id>", 'done')
     |                           |-- persist review task (done)   |
     |                           |-- HookRunner.run (review done) |
     |                           |                                |
     |   [manual or future hook auto-closes original task]        |
```

## Steps

### Step 1: Author submits for review
- Author calls `update_task({ id: 'task-1', new_status: 'pending_review' })`.
- No comment required (transition from `in_progress` is allowed).
- Hook `review-spawn` fires.

### Step 2: Review task created
- `review-spawn` hook creates task `"review-task-1"` with:
  - `status: 'todo'`
  - `title: 'Review: <original title>'`
  - `assignee.id`: reviewer agent session id (or a placeholder)
- Creation is **idempotent**: if `"review-task-1"` already exists, skip.

### Step 3: Reviewer agent spawned
- Reviewer agent connects via MCP (same-repo or remote — see `review-agent-config.md`).
- Reviewer calls `current_task()` → receives `"review-task-1"`.
- Reviewer updates it to `in_progress`, inspects the original task, evaluates against `definition_of_done`.

### Step 4: Reviewer completes
- Reviewer calls `update_task({ id: 'review-task-1', new_status: 'done' })`.
- Optionally adds a comment with feedback.

### Step 5: Original task finalization
- **MVP**: manual — author must call `update_task({ id: 'task-1', new_status: 'done' })` after review passes.
- **Post-MVP**: a hook on `review-task-1 → done` could auto-close `task-1`.
- If reviewer requests changes: reviewer moves original task back to `in_progress` with a comment.

## Invariants
- `"review-<id>"` id scheme ensures at most one review task per original task.
- The original task stays in `pending_review` while the review is in progress.
- The reviewer agent MUST update `review-<id>`, not the original task.
- Reviewer moving original task back to `in_progress` is a valid transition (`pending_review → in_progress`). The concurrent guard checks the **reviewer's** session for existing in_progress tasks, not the author's — each agent operates under its own `session_id`.

## Error Cases

| Scenario | Handling |
|----------|----------|
| Review task already exists | Hook skips creation, still spawns reviewer |
| Reviewer agent fails to connect | Script exits 0; review task remains in `todo` |
| Reviewer requests changes | Reviewer comments on original task and moves it to `in_progress` |
