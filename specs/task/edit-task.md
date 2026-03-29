---
id: task/edit-task
layer: task
status: ready
depends_on: [domain/types, domain/kTokens, task/ports]
test_file: tests/unit/task/edit-task.test.ts
source_file: src/task/edit-task.ts
module_path: "@logbook/task/edit-task"
priority: 3
---

# editTask

## Purpose
Edits mutable fields of an existing task without changing its status. Validates and derives Fibonacci estimation from predicted kilotokens when provided.

## Signature
```ts
import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface EditTaskInput {
  title?:              string
  description?:        string
  definition_of_done?: string
  predictedKTokens?:   number
}

export const editTask = (
  id: string,
  updates: EditTaskInput,
): Effect.Effect<Task, TaskError, TaskRepository>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `id` | `string` | Task to edit |
| `updates` | `EditTaskInput` | Partial — only provided fields are changed |

### Outputs
| Case | Return |
|------|--------|
| Valid id and updates | `Effect.succeed(updatedTask)` |
| Unknown id | `Effect.fail({ _tag: 'not_found', taskId: id })` |
| `predictedKTokens` provided but exceeds cap | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens exceed maximum allowed' })` |
| `status` field attempted via cast | `Effect.fail({ _tag: 'validation_error', ... })` |

### Invariants
- `task.status` is NEVER changed by `editTask`.
- Only fields present in `EditTaskInput` are updated; others retain their current value.
- The updated task is persisted via `repository.update` before returning.
- `status` is explicitly not in `EditTaskInput` — runtime detection required for boundary safety.
- When `predictedKTokens` is provided, the stored `task.estimation` is the derived Fibonacci number.

## Behaviour

### Happy Path
1. Call `repository.findById(id)`; propagate `not_found`.
2. Detect if `updates` contains a `status` key (system boundary guard); fail with `validation_error`.
3. If `updates.predictedKTokens` is provided, call `estimateFromKTokens`; propagate failure. Store returned Fibonacci as `task.estimation`.
4. Merge allowed fields into task (spread `{ ...task, ...filteredUpdates }`).
5. Call `repository.update(updatedTask)`; propagate `not_found`.
6. Return `updatedTask`.

### Edge Cases
- **`status` in updates**: fail with `validation_error` — status changes go through `updateTask`.
- **Empty updates `{}`**: no-op; persist unchanged task and return it.
- **Invalid predictedKTokens**: `estimateFromKTokens` handles all validation (non-number, non-positive, over-cap).

## Scenarios
```gherkin
Feature: editTask

  Scenario: edits title; status unchanged
    Given a task with status in_progress
    When editTask is called with title "New Title"
    Then task.title is "New Title"
    And task.status is unchanged

  Scenario: edits description
    When editTask is called with description "Updated desc"
    Then task.description is "Updated desc"

  Scenario: edits definition_of_done
    When editTask is called with definition_of_done "New DoD"
    Then task.definition_of_done is "New DoD"

  Scenario: edits predictedKTokens with valid value
    When editTask is called with predictedKTokens 8
    Then task.estimation is the Fibonacci bucket derived from 8k tokens

  Scenario: not_found for unknown id
    When editTask("ghost-id", ...) is called
    Then it fails with _tag "not_found"

  Scenario: predictedKTokens exceeds cap → validation_error
    When editTask is called with predictedKTokens 25
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens exceed maximum allowed"

  Scenario: attempting to set status field → validation_error
    When editTask is called with { status: 'done' } cast to EditTaskInput
    Then it fails with _tag "validation_error"
```

## Implementation Notes
- The `status` guard is a system boundary check — callers might bypass TypeScript with `as never`.
- Use `'status' in updates` to detect the forbidden field at runtime.
- Do NOT silently drop `status` — explicit failure is required so callers know they're misusing the API.

## Implementation Checklist
- [ ] Create `src/task/edit-task.ts`
- [ ] Define `EditTaskInput` interface
- [ ] Implement `editTask` with status guard, kTokens estimation, field merge
- [ ] Run `bun test tests/unit/task/edit-task.test.ts`
- [ ] All 7 scenarios pass

## Dependencies
- `@logbook/domain/types` — `Task`, `TaskError`
- `@logbook/domain/kTokens` — `estimateFromKTokens`
- `@logbook/task/ports` — `TaskRepository`
