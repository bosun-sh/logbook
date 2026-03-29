---
id: task/create-task
layer: task
status: ready
depends_on: [domain/types, domain/kTokens, task/ports]
test_file: tests/unit/task/create-task.test.ts
source_file: src/task/create-task.ts
module_path: "@logbook/task/create-task"
priority: 2
---

# createTask

## Purpose
Creates a new task in `backlog` status assigned to the calling session, validating all fields and deriving Fibonacci estimation from predicted kilotokens before persisting.

## Signature
```ts
import { Effect } from "effect"
import type { Task, TaskError } from "../domain/types.js"
import { TaskRepository } from "./ports.js"

export interface CreateTaskInput {
  project:            string
  milestone:          string
  title:              string
  definition_of_done: string
  description:        string
  predictedKTokens:   number
}

export const createTask = (
  input: CreateTaskInput,
  sessionId: string,
): Effect.Effect<Task, TaskError, TaskRepository>
```

## Contract

### Inputs
| Field | Validation |
|-------|-----------|
| `project` | non-empty string |
| `milestone` | non-empty string |
| `title` | non-empty string |
| `definition_of_done` | non-empty string |
| `description` | non-empty string |
| `predictedKTokens` | positive number, within maxKTokens cap |
| `sessionId` | used as `assignee.id` |

### Outputs
| Case | Return |
|------|--------|
| All valid | `Effect.succeed(Task)` with `status: 'backlog'` |
| Any string field empty | `Effect.fail({ _tag: 'validation_error', message: ... })` |
| `predictedKTokens` missing/undefined | `Effect.fail({ _tag: 'validation_error', ... })` |
| `predictedKTokens` exceeds cap | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens exceed maximum allowed' })` |
| `predictedKTokens` not positive | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens must be positive' })` |
| Duplicate id (rare) | `Effect.fail({ _tag: 'conflict', taskId })` — propagated from `repository.save` |

### Invariants
- Returned task has `status === 'backlog'`.
- `task.assignee.id === sessionId`.
- `task.id` is auto-generated, non-empty, unique.
- `task.comments` is `[]`.
- `task.in_progress_since` is `undefined`.
- Task is persisted before returning — retrievable via `findByStatus('backlog')`.

## Behaviour

### Happy Path
1. Validate all string fields are non-empty; fail with `validation_error` on first violation.
2. Call `estimateFromKTokens(input.predictedKTokens)`; propagate failure. Store returned Fibonacci as `task.estimation`.
3. Generate a unique `id` (e.g. UUID or crypto random).
4. Build `Task` object: `status: 'backlog'`, `comments: []`, `in_progress_since: undefined`, `assignee: { id: sessionId, title: sessionId, description: '' }`.
5. Call `repository.save(task)`; propagate `conflict` error.
6. Return the task.

### Edge Cases
- **Empty string fields**: fail with `validation_error` before touching the repository.
- **Invalid predictedKTokens**: `estimateFromKTokens` handles all validation (non-number, non-positive, over-cap).
- **Missing predictedKTokens** (undefined passed through): treat as validation_error.

## Scenarios
```gherkin
Feature: createTask

  Scenario: creates task in backlog
    Given valid input and sessionId "session-1"
    When createTask is called
    Then task.status is "backlog"
    And task is retrievable via findByStatus("backlog")

  Scenario: assignee.id equals sessionId
    Given sessionId is "session-abc"
    When createTask is called
    Then task.assignee.id is "session-abc"

  Scenario: auto-generated id is non-empty string
    When createTask is called
    Then task.id is a non-empty string

  Scenario Outline: missing required field → validation_error
    Given field <field> is empty string
    When createTask is called
    Then it fails with _tag "validation_error"

    Examples:
      | field              |
      | title              |
      | description        |
      | definition_of_done |
      | project            |
      | milestone          |

  Scenario: predictedKTokens exceeds cap → validation_error
    Given predictedKTokens is 21
    When createTask is called
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens exceed maximum allowed"

  Scenario: predictedKTokens not positive → validation_error
    Given predictedKTokens is 0
    When createTask is called
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens must be positive"

  Scenario: duplicate id → conflict
    Given a task with the same id already exists in the repository
    When repository.save is called with the same task
    Then it fails with _tag "conflict"
```

## Implementation Notes
- Use `crypto.randomUUID()` (available in Bun) for id generation.
- Assignee `title` and `description` fields: set `title` to `sessionId` and `description` to `''` unless richer agent info is available at call time.
- Validate fields before calling `estimateFromKTokens` — fail fast on the cheapest checks.
- Do NOT call `repository.update` — use `repository.save` for new tasks.
- The returned `task.estimation` is the Fibonacci number from `estimateFromKTokens`, not the raw kTokens value.

## Implementation Checklist
- [ ] Create `src/task/create-task.ts`
- [ ] Define `CreateTaskInput` interface
- [ ] Implement `createTask` with field validation, kTokens estimation, UUID generation
- [ ] Run `bun test tests/unit/task/create-task.test.ts`
- [ ] All 7 scenarios pass

## Dependencies
- `@logbook/domain/types` — `Task`, `TaskError`
- `@logbook/domain/kTokens` — `estimateFromKTokens`
- `@logbook/task/ports` — `TaskRepository`
