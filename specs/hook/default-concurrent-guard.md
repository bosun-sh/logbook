---
id: hook/default-concurrent-guard
layer: hook
status: draft
depends_on: [hook/ports, task/update-task]
test_file: tests/unit/task/update-task.test.ts
source_file: src/task/update-task.ts
module_path: n/a
priority: 2
---

# Default Logic: Concurrent in_progress Guard

## Purpose
Blocks a second task from entering `in_progress` for the same session unless a non-empty justification comment is provided. This is enforced inline in `updateTask` (Step 8), not as an external hook script.

## Location
This guard is **implemented inside `updateTask`** (Step 8 of the evaluation chain), not as a hook script. This spec documents the rule and its rationale separately for clarity.

## Contract

### Trigger Condition
- `newStatus === 'in_progress'`
- The session (`sessionId`) already has at least one other task in `in_progress`

### Rule
| Condition | Result |
|-----------|--------|
| No existing in_progress task for session | Proceed normally |
| Existing in_progress task + `comment === null` | Fail |
| Existing in_progress task + `comment.content.trim() === ''` | Fail |
| Existing in_progress task + `comment.content` non-empty | Proceed |

### Error Shape
The exact `_tag` is `validation_error` (consistent with the test asserting `err._tag` is truthy and the general validation_error pattern).

### Invariants
- Only tasks assigned to `sessionId` count — other sessions' tasks are invisible.
- The task being updated (id) is excluded from the "existing in_progress" check.
- The guard runs AFTER the transition is verified as allowed (Step 2) and AFTER the no-op check (Step 3).

## Behaviour

### Algorithm (within updateTask Step 8)
1. Query `repository.findByStatus('in_progress')`.
2. Filter: `task.assignee.id === sessionId AND task.id !== id`.
3. If result is empty: no guard, continue.
4. If result is non-empty:
   - If `comment === null` OR `comment.content.trim() === ''`: fail with `validation_error`.
   - Otherwise: continue (justification accepted).

## Scenarios
```gherkin
Feature: Concurrent in_progress guard

  Scenario: second task with empty justification → validation_error
    Given session-x has an in_progress task
    And task2 is in todo
    When updateTask(task2.id, 'in_progress', { content: "" }, "session-x")
    Then it fails with _tag "validation_error"
    And message is "concurrent in_progress tasks require a justification comment"

  Scenario: second task with non-empty justification → succeeds
    Given session-y has an in_progress task
    And task2 is in todo
    When updateTask(task2.id, 'in_progress', { content: "Urgent context switch" }, "session-y")
    Then task2.status is "in_progress"

  Scenario: first task (no existing in_progress) → succeeds with no extra constraint
    Given no in_progress tasks for session
    When updateTask(task.id, 'in_progress', null, session)
    Then task.status is "in_progress"
```

## Implementation Notes
- This guard does NOT need to be a separate hook script — embedding it in `updateTask` is correct and simpler.
- The test only asserts `err._tag` is truthy for the error case, so any non-empty `_tag` satisfies the contract.
- Recommend using `validation_error` with message `"concurrent in_progress tasks require a justification comment"` for consistency.

## Implementation Checklist
- [ ] Implement guard logic inside `updateTask` Step 8
- [ ] Query in_progress tasks, filter by session, exclude current task
- [ ] Fail with `validation_error` when justification is missing
- [ ] Covered by `tests/unit/task/update-task.test.ts` concurrent guard scenarios

## Dependencies
- `@logbook/task/update-task` — implemented within this module
- `@logbook/task/ports` — `TaskRepository`
