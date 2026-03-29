---
id: task/ports
layer: task
status: ready
depends_on: [domain/types]
test_file: none
source_file: src/task/ports.ts
module_path: "@logbook/task/ports"
priority: 2
---

# TaskRepository Port

## Purpose
Defines the `TaskRepository` interface — the single port through which all task persistence is accessed.

## Signature
```ts
import { Context, Effect } from "effect"
import type { Task, Status, TaskError } from "../domain/types.js"

export interface TaskRepository {
  findById(id: string): Effect.Effect<Task, TaskError>
  findByStatus(status: Status | '*'): Effect.Effect<readonly Task[], never>
  save(task: Task): Effect.Effect<void, TaskError>
  update(task: Task): Effect.Effect<void, TaskError>
}

export const TaskRepository = Context.GenericTag<TaskRepository>("TaskRepository")
```

## Contract

### Methods

| Method | Signature | Error conditions |
|--------|-----------|-----------------|
| `findById` | `(id: string) => Effect<Task, TaskError>` | `not_found` if id absent |
| `findByStatus` | `(status: Status \| '*') => Effect<readonly Task[], never>` | Never fails; returns `[]` when nothing matches |
| `save` | `(task: Task) => Effect<void, TaskError>` | `conflict` if task with same id already exists |
| `update` | `(task: Task) => Effect<void, TaskError>` | `not_found` if id absent |

### Invariants
- `findByStatus('*')` returns ALL tasks across all statuses.
- `findByStatus` never throws — an empty store returns `[]`.
- `save` is for new tasks only — it MUST NOT silently overwrite an existing task.
- `update` replaces the entire task record — callers are responsible for merging fields.
- `update` MUST NOT change the task's `id`.

## Implementation Notes
- This is a port (interface + tag) only — no implementation here.
- The Effect.ts `Context.GenericTag` pattern enables dependency injection via `Layer`.
- Concrete adapters: `JsonlTaskRepository` (infra layer), `InMemoryTaskRepository` (test helper).
- The `readonly Task[]` return on `findByStatus` prevents mutation of the returned slice.

## Implementation Checklist
- [ ] Create `src/task/ports.ts`
- [ ] Define `TaskRepository` interface with 4 methods
- [ ] Export `Context.GenericTag<TaskRepository>("TaskRepository")`

## Dependencies
- `@logbook/domain/types` — `Task`, `Status`, `TaskError`
- `effect` — `Context`, `Effect`
