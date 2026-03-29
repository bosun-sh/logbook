---
id: flows/need-info-flow
layer: flow
status: draft
depends_on: [task/update-task, hook/default-need-info, mcp/tool-update-task]
test_file: none
source_file: n/a
module_path: n/a
priority: 2
---

# Flow: need_info Comment → Reply → Unblock

## Purpose
Documents the full sequence an agent and human follow to resolve a blocking question and resume work.

## Sequence

```
Agent                          System                          Human
  |                              |                               |
  |-- update_task(→ need_info, comment: "What is the API key?")
  |                              |-- guardTransition ok          |
  |                              |-- persist task (need_info)    |
  |                              |-- HookRunner.run              |
  |                              |-- hook: need-info-notify  --> stdout notification
  |                              |                               |
  |                              |                    Human reads question
  |                              |                               |
  |                              |<-- update_task(same id, same status, reply comment)
  |                              |-- detect reply (Step 4)       |
  |                              |-- merge reply into comment    |
  |                              |-- persist task                |
  |                              |-- NO hook (reply-only)        |
  |                              |                               |
  |-- update_task(→ in_progress) |                               |
  |                              |-- guardTransition ok          |
  |                              |-- Step 7: check unreplied     |
  |                              |   all replies present → ok    |
  |                              |-- persist task (in_progress)  |
  |                              |-- HookRunner.run              |
  |<-- { ok: true }              |                               |
```

## Steps

### Step 1: Agent moves task to need_info
- `update_task({ id, new_status: 'need_info', comment: { kind: 'need_info', content: 'What is the API key?' } })`
- Comment MUST have `kind: 'need_info'`.
- `reply` field SHOULD be `''` (empty) at creation time.
- Hook fires → `need-info-notify` prints to stdout.

### Step 2: Human replies
- Human calls `update_task({ id, new_status: 'need_info', comment: { id: <comment_id>, kind: 'need_info', reply: 'The key is XYZ' } })`.
- `updateTask` detects this as a reply (Step 4): `comment.id` matches existing comment.
- Merges reply into comment, persists, returns succeed.
- **Status does NOT change. No hook fires.**

### Step 3: Agent resumes
- Agent calls `update_task({ id, new_status: 'in_progress' })`.
- `updateTask` Step 7 checks all `need_info` comments have non-empty reply.
- All replied → transition succeeds.
- `in_progress_since` is reset to `new Date()`.

## Invariants
- The agent cannot move to `in_progress` until ALL `need_info` comments are replied to.
- Reply does not change status or fire hooks.
- The original comment retains its `id` through the reply cycle — the reply is merged in-place.
- If the human sends a reply with an empty string, the comment's `reply` field becomes `''` (no change) — but the agent will be blocked when attempting to resume.

## Error Cases

| Scenario | Error |
|----------|-------|
| Agent moves to `need_info` without comment | `missing_comment` |
| Human replies to a `regular` comment | `validation_error: 'reply is only valid on need_info comments'` |
| Agent moves to `in_progress` with unreplied comment | `validation_error: 'blocking comment <id> has no reply'` |
