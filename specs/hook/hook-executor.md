---
id: hook/hook-executor
layer: hook
status: ready
depends_on: [hook/ports]
test_file: tests/unit/hook/hook-executor.test.ts
source_file: src/hook/hook-executor.ts
module_path: "@logbook/hook/hook-executor"
priority: 2
---

# executeHooks

## Purpose
Executes all hooks whose event matches and whose condition (if any) evaluates to true. Hooks exceeding `timeout_ms` are terminated. Always returns `Effect.succeed(void)`.

## Signature
```ts
import { Effect } from "effect"
import type { HookEvent } from "./ports.js"

export interface HookConfig {
  event:       string
  condition?:  string
  timeout_ms?: number
  script:      string
}

export const executeHooks = (
  event: HookEvent,
  configs: readonly HookConfig[],
): Effect.Effect<void, never>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `event` | `HookEvent` | The lifecycle event |
| `configs` | `readonly HookConfig[]` | All hook configs to evaluate |

### HookConfig Fields
| Field | Required | Notes |
|-------|----------|-------|
| `event` | yes | Must equal `"task.status_changed"` to match current events |
| `condition` | no | JS-like expression; absent means always fire |
| `timeout_ms` | no | Default: `5000` ms |
| `script` | yes | Shell command to execute |

### Outputs
- Always `Effect.succeed(void)` — hook errors and timeouts MUST be swallowed.

### Environment Variables Passed to Script
| Variable | Value |
|----------|-------|
| `LOGBOOK_TASK_ID` | `event.task_id` |
| `LOGBOOK_OLD_STATUS` | `event.old_status` |
| `LOGBOOK_NEW_STATUS` | `event.new_status` |
| `LOGBOOK_SESSION_ID` | `event.session_id` |

### Invariants
- A hook with a non-matching condition MUST NOT execute.
- A hook with no condition MUST always execute (when event matches).
- Multiple hooks on the same event all fire (no short-circuit).
- A hook that times out is killed; `executeHooks` continues and returns succeed.
- Hook errors (non-zero exit, crash) are logged and ignored — never propagated.

## Behaviour

### Happy Path
1. For each config in `configs`:
   a. Check `config.event === 'task.status_changed'` (the only event type in MVP).
   b. If `condition` is present, evaluate it against `{ new_status, old_status, task_id, session_id }`; skip if falsy.
   c. Spawn `config.script` as a shell command with the env vars above.
   d. Wait up to `config.timeout_ms ?? 5000` ms; kill if exceeded.
   e. Log any error; continue to next hook.
2. Return `Effect.succeed(undefined)`.

### Condition Evaluation
- Condition syntax: simple JS-like expression, e.g. `"new_status == 'need_info'"`.
- Evaluated with `new_status`, `old_status`, `task_id`, `session_id` in scope.
- Any evaluation error → condition is treated as false (hook does not fire).
- Use `new Function(...)` or a safe evaluator — NOT `eval` directly in production code.

### Edge Cases
- **Empty configs**: returns succeed immediately.
- **Condition throws**: treated as false; hook skipped.
- **Script times out**: process killed after `timeout_ms`; marker file NOT created.
- **Script fails (non-zero exit)**: swallowed; execution continues.

## Scenarios
```gherkin
Feature: executeHooks

  Scenario: hook with matching condition fires
    Given a hook with condition "new_status == 'need_info'"
    And event.new_status is "need_info"
    When executeHooks is called
    Then the script executes (marker file created)

  Scenario: hook with non-matching condition does not fire
    Given a hook with condition "new_status == 'done'"
    And event.new_status is "need_info"
    When executeHooks is called
    Then the script does not execute (no marker file)

  Scenario: hook with no condition fires every time
    Given a hook with no condition
    When executeHooks is called
    Then the script executes

  Scenario: two hooks on same event both fire
    Given two hooks on event "task.status_changed" with no condition
    When executeHooks is called
    Then both scripts execute

  Scenario: hook exceeding timeout_ms is terminated
    Given a hook with timeout_ms 50 and script "sleep 999"
    When executeHooks is called
    Then executeHooks returns succeed
    And script did not complete (no marker file)

  Scenario: hook context passes env vars to script
    Given a hook that writes "$LOGBOOK_TASK_ID $LOGBOOK_OLD_STATUS $LOGBOOK_NEW_STATUS" to a file
    When executeHooks is called with task_id "t-1", old "in_progress", new "need_info"
    Then file contains "t-1 in_progress need_info"
```

## Implementation Notes
- Use `Bun.spawn` or Node `child_process.spawn` for script execution.
- Set `{ shell: true }` so scripts can use shell syntax (`&&`, pipes, etc.).
- Pass env vars via the `env` option merged with `process.env`.
- Timeout: use `AbortController` or `Promise.race` with a `setTimeout`; kill the child process on timeout.
- Condition evaluation: construct `new Function('new_status', 'old_status', 'task_id', 'session_id', 'return (' + condition + ')')` and call it with event values. **Security note**: MVP-acceptable since conditions come from trusted config files; post-MVP consider a safe expression evaluator.
- All hook execution is fire-and-forget from the error perspective — wrap everything in try/catch.

## Implementation Checklist
- [ ] Create `src/hook/hook-executor.ts`
- [ ] Define `HookConfig` interface
- [ ] Implement `executeHooks` with event matching, condition evaluation, timeout, error swallowing
- [ ] Run `bun test tests/unit/hook/hook-executor.test.ts`
- [ ] All 6 scenarios pass

## Dependencies
- `@logbook/hook/ports` — `HookEvent`
