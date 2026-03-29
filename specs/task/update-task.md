---
id: task/update-task
layer: task
status: ready
depends_on: [domain/types, domain/status-machine, task/ports, hook/ports]
test_file: tests/unit/task/update-task.test.ts
source_file: src/task/update-task.ts
module_path: "@logbook/task/update-task"
priority: 1
---

# updateTask

## Purpose
Transitions a task to a new status, optionally attaching or replying to a comment. Enforces transition rules, comment requirements, need_info reply cycle, and concurrent in_progress justification. Fires `HookRunner` after a successful status change.

## Signature
```ts
import { Effect } from "effect"
import type { Status, Comment, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"
import { HookRunner } from "../hook/ports.js"

export const updateTask = (
  id: string,
  newStatus: Status,
  comment: Comment | null,
  sessionId: string,
): Effect.Effect<void, TaskError, TaskRepository | HookRunner>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `id` | `string` | Task to update |
| `newStatus` | `Status` | Target status |
| `comment` | `Comment \| null` | Optional comment to attach or use as reply |
| `sessionId` | `string` | Calling session (used for concurrent guard) |

### Outputs
| Case | Return |
|------|--------|
| Success | `Effect.succeed(void)` |
| Task not found | `Effect.fail({ _tag: 'not_found', taskId: id })` |
| Forbidden transition | `Effect.fail({ _tag: 'transition_not_allowed', from, to })` |
| `→ need_info` without comment | `Effect.fail({ _tag: 'missing_comment' })` |
| `→ blocked` without comment | `Effect.fail({ _tag: 'missing_comment' })` |
| `→ blocked` with empty content | `Effect.fail({ _tag: 'validation_error', ... })` |
| Reply on `kind: 'regular'` comment | `Effect.fail({ _tag: 'validation_error', message: 'reply is only valid on need_info comments' })` |
| `need_info → in_progress` with unreplied comment | `Effect.fail({ _tag: 'validation_error', message: 'blocking comment <id> has no reply' })` |
| Second in_progress with no/empty justification | error (non-empty comment required) |

### Hook Firing Rule
**Hook fires if and only if `old_status !== new_status` AND no error occurred.**

## Behaviour

### Ordered Evaluation Chain (must execute in this order)

**Step 1 — Fetch task**
- Call `repository.findById(id)`.
- Fail with `not_found` if absent.

**Step 2 — Guard transition**
- Call `guardTransition(task.status, newStatus)`.
- Fail with `transition_not_allowed` if forbidden.

**Step 3 — No-op check**
- If `task.status === newStatus`: persist nothing, fire no hook, return `Effect.succeed(void)`.

**Step 4 — Comment reply routing**
- If `comment` is provided AND `comment.id` matches an existing comment in `task.comments`:
  - If the existing comment's `kind === 'regular'`: fail with `validation_error: 'reply is only valid on need_info comments'`.
  - If `kind === 'need_info'`: merge reply into that comment (`existing.reply = comment.reply`), persist task, return succeed. **No status change. No hook.**

**Step 5 — need_info comment requirement**
- If `newStatus === 'need_info'` AND `comment === null`: fail with `missing_comment`.

**Step 6 — blocked comment requirement**
- If `newStatus === 'blocked'` AND `comment === null`: fail with `missing_comment`.
- If `newStatus === 'blocked'` AND `comment.content.trim() === ''`: fail with `validation_error`.

**Step 7 — need_info → in_progress unblock check**
- If `task.status === 'need_info'` AND `newStatus === 'in_progress'`:
  - Find all comments where `kind === 'need_info'` AND `reply === ''`.
  - If any exist, fail with `validation_error: 'blocking comment <id> has no reply'` (use id of first unreplied comment).

**Step 8 — Concurrent in_progress guard**
- If `newStatus === 'in_progress'`:
  - Query `repository.findByStatus('in_progress')`.
  - Filter tasks where `task.assignee.id === sessionId` AND `task.id !== id`.
  - If any exist AND (`comment === null` OR `comment.content.trim() === ''`): fail with `validation_error`.

**Step 9 — Apply and persist**
- Capture `const oldStatus = task.status` **before** mutation.
- Build updated task:
  - Set `task.status = newStatus`.
  - If `newStatus === 'in_progress'`: set `in_progress_since = new Date()`.
  - If comment is present (and not a reply to existing): append to `task.comments`.
- Call `repository.update(updatedTask)`.
- Call `HookRunner.run({ task_id: id, old_status: oldStatus, new_status: newStatus, comment, session_id: sessionId })`.
- Return `Effect.succeed(void)`.

### Invariants
- Hook fires exactly once per successful status change, never on errors, never on no-ops, never on reply-only updates.
- Comment reply (Step 4) causes NO status change and NO hook.
- Task is never persisted if any step 1–8 fails.
- `in_progress_since` is set fresh each time a task enters `in_progress`.

## Scenarios
```gherkin
Feature: updateTask

  Scenario Outline: valid transition changes status and fires hook
    Given a task with status <from>
    When updateTask is called with newStatus <to>
    Then task.status is <to>
    And hook fired once with new_status <to>

    Examples: (all 11 allowed transitions from status-machine)

  Scenario Outline: forbidden transition fails, task unchanged, no hook
    Given a task with status <from>
    When updateTask(<from> → <to>) is called
    Then it fails with _tag "transition_not_allowed"
    And task.status is still <from>
    And no hook fired

  Scenario: no-op (blocked → blocked) succeeds, no hook
    Given a task with status blocked
    When updateTask(id, 'blocked', null, session) is called
    Then it succeeds
    And no hook fired

  Scenario: nonexistent id → not_found
    When updateTask("ghost-id", ...) is called
    Then it fails with _tag "not_found"

  Scenario: → need_info without comment → missing_comment
  Scenario: → need_info with comment → hook fires with new_status need_info

  Scenario: → blocked without comment → missing_comment
  Scenario: → blocked with empty content → validation_error
  Scenario: → blocked with non-empty content → succeeds

  Scenario: reply on need_info comment → reply populated, status stays need_info, no hook
    Given task with need_info comment id "c-1" and empty reply
    When updateTask called with comment { id: "c-1", reply: "the answer", kind: 'need_info' }
    Then task.comments["c-1"].reply is "the answer"
    And task.status is still "need_info"
    And no hook fired

  Scenario: reply on regular comment → validation_error

  Scenario: need_info→in_progress with unreplied blocking comment → validation_error
    With message "blocking comment c-1 has no reply"

  Scenario: need_info→in_progress after all replies populated → succeeds

  Scenario: second in_progress task without justification → error
  Scenario: second in_progress task with non-empty justification → succeeds
  Scenario: first in_progress task (no existing) → succeeds with no extra constraint
```

## Implementation Notes
- The evaluation chain must be sequential — use `Effect.flatMap` chains, not `Effect.all`.
- `old_status` for the hook event is `task.status` captured BEFORE mutating the task object.
- Reply detection (Step 4): match by `comment.id` in `task.comments` array — NOT by content.
- For the concurrent guard (Step 8), filter by `task.assignee.id === sessionId` AND exclude the current task by id (a task already in_progress being re-set is handled by the no-op in Step 3).
- `in_progress_since` should only be set on entry to `in_progress`, not preserved from a previous in_progress spell.

## Implementation Checklist
- [ ] Create `src/task/update-task.ts`
- [ ] Implement 9-step evaluation chain using `Effect.flatMap`
- [ ] Capture `oldStatus` before mutation for hook event
- [ ] Run `bun test tests/unit/task/update-task.test.ts`
- [ ] All scenarios pass (transitions, no-ops, comments, replies, concurrent guard)

## Dependencies
- `@logbook/domain/types` — `Status`, `Comment`, `TaskError`
- `@logbook/domain/status-machine` — `guardTransition`
- `@logbook/task/ports` — `TaskRepository`
- `@logbook/hook/ports` — `HookRunner`, `HookEvent`
