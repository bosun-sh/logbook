---
id: infra/jsonl-task-repository
layer: infra
status: ready
depends_on: [domain/types, task/ports]
test_file: tests/e2e/jsonl-repository.test.ts
source_file: src/infra/jsonl-task-repository.ts
module_path: "@logbook/infra/jsonl-task-repository"
priority: 1
---

# JsonlTaskRepository

## Purpose
JSONL-backed implementation of `TaskRepository`. Each line is a JSON-serialized `Task`. Reads scan the full file; writes are append-only for `save`, full-rewrite for `update`.

## Signature
```ts
import { Effect } from "effect"
import type { Task, Status, TaskError } from "../domain/types.js"
import type { TaskRepository } from "../task/ports.js"

export class JsonlTaskRepository implements TaskRepository {
  constructor(private readonly filePath: string) {}

  findById(id: string): Effect.Effect<Task, TaskError>
  findByStatus(status: Status | '*'): Effect.Effect<readonly Task[], never>
  save(task: Task): Effect.Effect<void, TaskError>
  update(task: Task): Effect.Effect<void, TaskError>
}
```

## Contract

### Constructor
| Param | Type | Notes |
|-------|------|-------|
| `filePath` | `string` | Path to the `.jsonl` file; created on first write if absent |

### findById
| Case | Return |
|------|--------|
| Found | `Effect.succeed(task)` |
| Not found | `Effect.fail({ _tag: 'not_found', taskId: id })` |

### findByStatus
| Case | Return |
|------|--------|
| Always | `Effect.succeed(tasks)` — empty array if none match |

- Scans full file, parses each line, filters by `task.status === status`.
- `'*'` returns all lines.

### save
| Case | Return |
|------|--------|
| id is new | Appends JSON line; `Effect.succeed(void)` |
| id already exists | `Effect.fail({ _tag: 'conflict', taskId: task.id })` |

- Conflict check: scan file for existing task with same id before appending.

### update
| Case | Return |
|------|--------|
| id found | Rewrites entire file with updated task in place; `Effect.succeed(void)` |
| id not found | `Effect.fail({ _tag: 'not_found', taskId: task.id })` |

### Invariants
- Each line in the file is a complete, valid JSON-serialized `Task`.
- `save` is append-only — never rewrites the file.
- `update` rewrites the whole file atomically (write to temp file, rename).
- Task parsing uses `TaskSchema.parse` — malformed lines must not corrupt reads.
- File creation: if `filePath` does not exist, `save` creates it; `findById`/`findByStatus` on missing file return empty/not_found without error.

## Behaviour

### findById — Algorithm
1. Read file line by line.
2. Parse each line with `TaskSchema.safeParse`.
3. Skip lines that fail to parse (log warning).
4. Return first task where `task.id === id`.
5. If no match, fail with `not_found`.

### findByStatus — Algorithm
1. Read file (return `[]` if file does not exist).
2. Parse each line; skip invalid lines.
3. Filter by `status === '*' || task.status === status`.
4. Return array.

### save — Algorithm
1. Call `findById(task.id)` to check for conflicts.
2. If found, fail with `conflict`.
3. Append `JSON.stringify(task) + '\n'` to file.

### update — Algorithm
1. Read all lines; parse each.
2. Find index of task with matching id; fail with `not_found` if absent.
3. Replace that task with the new value.
4. Write all lines to a temp file; rename to `filePath` (atomic swap).

### Edge Cases
- **File does not exist on read**: return `[]` / `not_found`.
- **Malformed JSONL line**: skip silently with a console warning.
- **Concurrent writes**: not handled in MVP — single-writer assumption.

## Scenarios
```gherkin
Feature: JsonlTaskRepository

  Scenario: save persists task, findById retrieves it
    Given an empty tasks.jsonl
    When save(task) is called
    Then findById(task.id) returns the task

  Scenario: findByStatus returns matching tasks
    Given tasks with statuses backlog, todo, in_progress
    When findByStatus("backlog") is called
    Then only the backlog task is returned

  Scenario: save on duplicate id → conflict
    Given a task already saved with id "t-1"
    When save({ ...task, id: "t-1" }) is called
    Then it fails with _tag "conflict"

  Scenario: update replaces task
    Given task "t-1" with title "Old"
    When update({ ...task, title: "New" }) is called
    Then findById("t-1").title is "New"

  Scenario: update on missing id → not_found
    When update(task) is called on empty file
    Then it fails with _tag "not_found"

  Scenario: findById on missing file → not_found
    Given tasks.jsonl does not exist
    When findById("t-1") is called
    Then it fails with _tag "not_found"
```

## Implementation Notes
- Use `Bun.file(filePath).text()` for reads; `Bun.write` for writes.
- Atomic update: write to `filePath + '.tmp'`, then `fs.rename`.
- Parse with `TaskSchema.safeParse` — never `JSON.parse` directly without validation.
- `in_progress_since` is stored as ISO string; `z.coerce.date()` handles round-trip.

## Implementation Checklist
- [ ] Create `src/infra/jsonl-task-repository.ts`
- [ ] Implement `JsonlTaskRepository` with JSONL read/write, atomic update via temp file rename
- [ ] Run `bun test tests/e2e/jsonl-repository.test.ts`
- [ ] All 6 scenarios pass

## Dependencies
- `@logbook/domain/types` — `Task`, `Status`, `TaskError`, `TaskSchema`
- `@logbook/task/ports` — `TaskRepository`
