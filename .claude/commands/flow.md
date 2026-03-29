# Logbook Task Flow Protocol

You are operating inside a logbook-managed project. Follow this protocol for every work session.

## On Session Start

Always call `current_task` before doing anything else. This returns the highest-priority `in_progress` task assigned to your session.

- If a task is returned: that is your work item. Read `title`, `description`, and `definition_of_done` carefully before acting.
- If no task is returned: call `list_tasks` with status `todo` and pick the highest-value item, then `update_task` it to `in_progress`.

## Status Transitions

| From | To | Comment required? | Notes |
|------|----|-------------------|-------|
| `backlog` | `todo` | No | Grooming only |
| `todo` | `in_progress` | No | Sets `in_progress_since` |
| `in_progress` | `need_info` | **Yes** — blocking question | Triggers user notification |
| `need_info` | `in_progress` | **Yes** — answer to the question | Must quote and answer every open `need_info` comment |
| `in_progress` | `blocked` | **Yes** — blocker description | External dependency, not a question |
| `blocked` | `in_progress` | **Yes** — how blocker was resolved | |
| `in_progress` | `pending_review` | No | Triggers reviewer subagent spawn |
| `pending_review` | `in_progress` | **Yes** — reviewer's issues | Reviewer only; never self-approve |
| `pending_review` | `done` | **Yes** — approval note | Reviewer only |

## Need-Info Reply Cycle

When a task is in `need_info`, **do not proceed** until all open questions are answered.

1. Read every comment with `kind: 'need_info'` where `reply` is empty.
2. Gather or reason through the answer.
3. Call `update_task` with `new_status: 'in_progress'` and a comment whose `reply` field contains the answer.

Never transition back to `in_progress` with an empty or placeholder reply.

## One Task at a Time

Only one task may be `in_progress` per session. If you need to start a second task:

1. Either move the current task to `pending_review`, `blocked`, or `need_info` first.
2. Or provide a justification comment when the server prompts you — the hook will enforce this.

## Submitting for Review

When `definition_of_done` is satisfied:

1. Call `update_task` with `new_status: 'pending_review'`.
2. Do not mark `done` yourself. The reviewer subagent handles the final transition.
3. Wait for the reviewer to respond (task will return to `in_progress` with issues, or move to `done`).

## Editing Tasks

Use `edit_task` to update mutable fields (`title`, `description`, `definition_of_done`, `estimation`) without triggering lifecycle hooks. Never use `update_task` for metadata-only changes.

## Creating Tasks

Use `create_task` when you discover work that is not yet tracked. Always set:
- `project` and `milestone` matching the current work context
- A clear `definition_of_done` — not "done" but a specific, verifiable outcome
- `estimation` on the fibonacci scale: 1, 2, 3, 5, 8, 13

New tasks start in `backlog`. Move to `todo` only after grooming.
