---
id: hook/ports
layer: hook
status: ready
depends_on: [domain/types]
test_file: none
source_file: src/hook/ports.ts
module_path: "@logbook/hook/ports"
priority: 2
---

# HookRunner + HookEvent Ports

## Purpose
Defines the `HookEvent` data type and `HookRunner` interface — the port through which task lifecycle events are dispatched to hook implementations.

## Signature
```ts
import { Context, Effect } from "effect"
import type { Status, Comment } from "../domain/types.js"

export interface HookEvent {
  task_id:    string
  old_status: Status
  new_status: Status
  comment:    Comment | null
  session_id: string
}

export interface HookRunner {
  run(event: HookEvent): Effect.Effect<void, never>
}

export const HookRunner = Context.GenericTag<HookRunner>("HookRunner")
```

## Contract

### HookEvent Fields

| Field | Type | Notes |
|-------|------|-------|
| `task_id` | `string` | The task that changed status |
| `old_status` | `Status` | Status before the transition |
| `new_status` | `Status` | Status after the transition |
| `comment` | `Comment \| null` | Comment attached to the transition, if any |
| `session_id` | `string` | Session that triggered the update |

### HookRunner.run

| Aspect | Contract |
|--------|----------|
| Return type | `Effect<void, never>` — MUST NOT fail |
| Error handling | Hook errors MUST be logged and swallowed; never propagate to callers |
| Timing | Fired ONLY after a successful status change (`old_status !== new_status`) |
| No-ops | MUST NOT fire on same→same transitions |

### Invariants
- `HookRunner.run` returns `Effect<void, never>` — implementations cannot leak errors to callers.
- `comment` is `null` for transitions that don't require a comment.
- `old_status` and `new_status` will differ when `run` is called (enforced by `updateTask`).

## Implementation Notes
- This is a port only — no logic here.
- Concrete implementations: `executeHooks`-backed runner (production), `SpyHookRunner` (tests).
- The `never` error channel is deliberate — hook failures are fire-and-forget; they MUST NOT block task workflows.

## Implementation Checklist
- [ ] Create `src/hook/ports.ts`
- [ ] Define `HookEvent` interface
- [ ] Define `HookRunner` interface with `run` method
- [ ] Export `Context.GenericTag<HookRunner>("HookRunner")`

## Dependencies
- `@logbook/domain/types` — `Status`, `Comment`
- `effect` — `Context`, `Effect`
