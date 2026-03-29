---
id: task/list-tasks
layer: task
status: ready
depends_on: [domain/types, task/ports]
test_file: tests/unit/task/list-tasks.test.ts
source_file: src/task/list-tasks.ts
module_path: "@logbook/task/list-tasks"
priority: 1
---

# listTasks

## Purpose
Returns tasks matching the given status, or all tasks when status is `'*'`. Never fails.

## Signature
```ts
import { Effect } from "effect"
import type { Task, Status } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export const listTasks = (
  status: Status | '*',
): Effect.Effect<readonly Task[], never, TaskRepository>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `status` | `Status \| '*'` | `'*'` matches all statuses |

### Outputs
| Case | Return |
|------|--------|
| Matching tasks exist | `Effect.succeed(tasks)` |
| No matching tasks | `Effect.succeed([])` |
| `status === '*'` | `Effect.succeed(allTasks)` |

### Invariants
- Return type is `Effect<readonly Task[], never>` — MUST NOT fail under any circumstance.
- `'*'` returns tasks of all statuses in repository-defined order.
- Result is `readonly` — callers must not mutate the returned array.

## Behaviour

### Happy Path
1. Call `repository.findByStatus(status)`.
2. Return the result directly.

### Edge Cases
- **Empty repository**: returns `[]`.
- **No tasks match**: returns `[]`.
- **`'*'`**: delegates to `repository.findByStatus('*')` — no client-side filtering needed.

## Scenarios
```gherkin
Feature: listTasks

  Scenario: returns only tasks matching status
    Given tasks with statuses backlog, todo, in_progress
    When listTasks("backlog") is called
    Then result has 1 task with status "backlog"

  Scenario: returns empty array when no tasks match
    Given 1 task with status backlog
    When listTasks("done") is called
    Then result is []

  Scenario: '*' returns all tasks across all statuses
    Given tasks with statuses backlog, todo, done
    When listTasks("*") is called
    Then result has 3 tasks

  Scenario: 'in_progress' correctly filters
    Given 2 tasks with status in_progress and 1 with backlog
    When listTasks("in_progress") is called
    Then result has 2 tasks, all with status "in_progress"
```

## Implementation Notes
- This function is a thin delegation to `TaskRepository.findByStatus` — no additional logic needed.
- Do NOT add sorting, pagination, or filtering beyond what `status` provides.

## Implementation Checklist
- [ ] Create `src/task/list-tasks.ts`
- [ ] Implement `listTasks` as delegation to `repository.findByStatus`
- [ ] Run `bun test tests/unit/task/list-tasks.test.ts`
- [ ] All 4 scenarios pass

## Dependencies
- `@logbook/domain/types` — `Task`, `Status`
- `@logbook/task/ports` — `TaskRepository`
