---
id: task/current-task
layer: task
status: ready
depends_on: [domain/types, task/ports]
test_file: tests/unit/task/current-task.test.ts
source_file: src/task/current-task.ts
module_path: "@logbook/task/current-task"
priority: 1
---

# currentTask

## Purpose
Returns the oldest `in_progress` task assigned to the given session (FIFO by `in_progress_since`). Fails with `no_current_task` when the session has no in_progress tasks.

## Signature
```ts
import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export const currentTask = (
  sessionId: string,
): Effect.Effect<Task, TaskError, TaskRepository>
```

## Contract

### Inputs
| Param | Type |
|-------|------|
| `sessionId` | `string` — the session whose task is requested |

### Outputs
| Case | Return |
|------|--------|
| Session has ≥1 in_progress tasks | `Effect.succeed(oldestTask)` |
| Session has 0 in_progress tasks | `Effect.fail({ _tag: 'no_current_task' })` |

### Invariants
- Sessions are isolated: tasks assigned to other sessions are invisible.
- When multiple in_progress tasks exist for the same session, the one with the earliest `in_progress_since` is returned.
- The task is matched by `task.assignee.id === sessionId`.

## Behaviour

### Happy Path
1. Call `repository.findByStatus('in_progress')`.
2. Filter to tasks where `task.assignee.id === sessionId`.
3. If empty, return `Effect.fail({ _tag: 'no_current_task' })`.
4. Sort ascending by `in_progress_since` (earliest first).
5. Return `Effect.succeed(tasks[0])`.

### Edge Cases
- **No in_progress tasks at all**: `no_current_task`.
- **In_progress tasks exist but for different session**: `no_current_task`.
- **Multiple tasks for same session**: return the one with earliest `in_progress_since`.
- **`in_progress_since` is undefined**: treat as epoch (0) for sorting — these sort before dated tasks. (Defensive: `in_progress_since` should always be set when status is `in_progress`.)

## Scenarios
```gherkin
Feature: currentTask

  Scenario: returns oldest in_progress task for session (FIFO)
    Given session-1 has tasks t-old (in_progress_since: 2026-01-01T08:00Z)
    And session-1 has task t-new (in_progress_since: 2026-01-01T09:00Z)
    When currentTask("session-1") is called
    Then it returns t-old

  Scenario: no in_progress tasks → no_current_task
    Given only a backlog task exists
    When currentTask("session-1") is called
    Then it fails with _tag "no_current_task"

  Scenario: sessions are isolated
    Given session-1 has an in_progress task
    When currentTask("session-2") is called
    Then it fails with _tag "no_current_task"
```

## Implementation Notes
- Do NOT add a `findBySessionId` method to the repository — filter in application logic.
- The sort is stable for equal `in_progress_since` values; insertion order is the tiebreaker.

## Implementation Checklist
- [ ] Create `src/task/current-task.ts`
- [ ] Implement `currentTask` with session filtering and FIFO sort by `in_progress_since`
- [ ] Run `bun test tests/unit/task/current-task.test.ts`
- [ ] All 3 scenarios pass

## Dependencies
- `@logbook/domain/types` — `Task`, `TaskError`
- `@logbook/task/ports` — `TaskRepository`
