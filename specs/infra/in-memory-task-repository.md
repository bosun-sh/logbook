---
id: infra/in-memory-task-repository
layer: infra
status: ready
depends_on: [domain/types, task/ports]
test_file: none
source_file: src/infra/in-memory-task-repository.ts
module_path: "@logbook/infra/in-memory-task-repository"
priority: 1
---

# InMemoryTaskRepository

## Purpose
In-memory implementation of `TaskRepository` used as the test helper for all unit tests. Provides the same contract as `JsonlTaskRepository` without filesystem I/O.

## Signature
```ts
import { Effect } from "effect"
import type { Task, Status, TaskError } from "../domain/types.js"
import type { TaskRepository } from "../task/ports.js"

export class InMemoryTaskRepository implements TaskRepository {
  private tasks: Map<string, Task> = new Map()

  findById(id: string): Effect.Effect<Task, TaskError>
  findByStatus(status: Status | '*'): Effect.Effect<readonly Task[], never>
  save(task: Task): Effect.Effect<void, TaskError>
  update(task: Task): Effect.Effect<void, TaskError>
}
```

## Contract

### findById
| Case | Return |
|------|--------|
| Found | `Effect.succeed(task)` |
| Not found | `Effect.fail({ _tag: 'not_found', taskId: id })` |

### findByStatus
| Case | Return |
|------|--------|
| Always | `Effect.succeed(tasks)` — empty array if none match |

### save
| Case | Return |
|------|--------|
| id is new | Stores task in map; `Effect.succeed(void)` |
| id already exists | `Effect.fail({ _tag: 'conflict', taskId: task.id })` |

### update
| Case | Return |
|------|--------|
| id found | Replaces task in map; `Effect.succeed(void)` |
| id not found | `Effect.fail({ _tag: 'not_found', taskId: task.id })` |

### Invariants
- Behaviour is identical to `JsonlTaskRepository` — tests using this helper are valid for the production adapter.
- Internal state is a `Map<string, Task>` — insertion order is preserved for deterministic `findByStatus` results.
- No filesystem access — pure in-memory operations.
- Not thread-safe — single-writer assumption matches the production adapter.

## Behaviour

### findById
1. Look up `id` in the map.
2. If found, return `Effect.succeed(task)`.
3. If not, return `Effect.fail({ _tag: 'not_found', taskId: id })`.

### findByStatus
1. Iterate all values in the map.
2. Filter by `status === '*' || task.status === status`.
3. Return `Effect.succeed(filtered)`.

### save
1. Check if `id` exists in the map.
2. If exists, return `Effect.fail({ _tag: 'conflict', taskId: task.id })`.
3. Otherwise, set `map.set(task.id, task)` and return `Effect.succeed(void)`.

### update
1. Check if `id` exists in the map.
2. If not, return `Effect.fail({ _tag: 'not_found', taskId: task.id })`.
3. Otherwise, set `map.set(task.id, task)` and return `Effect.succeed(void)`.

## Scenarios
```gherkin
Feature: InMemoryTaskRepository

  Scenario: save and findById round-trip
    Given an empty repository
    When save(task) is called
    Then findById(task.id) returns the task

  Scenario: findByStatus filters correctly
    Given tasks with statuses backlog, todo, in_progress
    When findByStatus("backlog") is called
    Then only the backlog task is returned

  Scenario: save on duplicate id → conflict
    Given a task already saved with id "t-1"
    When save({ ...task, id: "t-1" }) is called
    Then it fails with _tag "conflict"

  Scenario: update replaces task in map
    Given task "t-1" with title "Old"
    When update({ ...task, title: "New" }) is called
    Then findById("t-1").title is "New"

  Scenario: update on missing id → not_found
    Given an empty repository
    When update(task) is called
    Then it fails with _tag "not_found"

  Scenario: findByStatus('*') returns all tasks
    Given 3 tasks with different statuses
    When findByStatus('*') is called
    Then all 3 tasks are returned
```

## Implementation Checklist
- [ ] Create `src/infra/in-memory-task-repository.ts`
- [ ] Implement all 4 `TaskRepository` methods using `Map<string, Task>`
- [ ] Verify contract parity with `JsonlTaskRepository` spec

## Implementation Notes
- This is the test double used by every unit test that requires `TaskRepository`.
- Keep the implementation minimal — no validation beyond what the interface demands.
- Use `structuredClone` when returning tasks from `findById`/`findByStatus` to prevent mutation of internal state (defensive copy).

## Dependencies
- `@logbook/domain/types` — `Task`, `Status`, `TaskError`
- `@logbook/task/ports` — `TaskRepository`
- `effect` — `Effect`
