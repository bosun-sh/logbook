---
id: domain/status-machine
layer: domain
status: ready
depends_on: [domain/types]
test_file: tests/unit/domain/status-machine.test.ts
source_file: src/domain/status-machine.ts
module_path: "@logbook/domain/status-machine"
priority: 2
---

# guardTransition

## Purpose
Guards a status transition, succeeding when the transition is allowed and failing with `transition_not_allowed` otherwise.

## Signature
```ts
import { Effect } from "effect"
import type { Status, TaskError } from "./types.js"

export const guardTransition = (
  from: Status,
  to: Status,
): Effect.Effect<void, TaskError>
```

## Contract

### Inputs
| Param | Type |
|-------|------|
| `from` | `Status` |
| `to` | `Status` |

### Outputs
| Case | Return |
|------|--------|
| Transition is in the allowed set | `Effect.succeed(void)` |
| `from === to` (same→same) | `Effect.succeed(void)` — no-op |
| Transition is not allowed | `Effect.fail({ _tag: 'transition_not_allowed', from, to })` |

### Allowed Transitions (complete graph)

| From | To |
|------|----|
| `backlog` | `todo` |
| `todo` | `backlog` |
| `todo` | `in_progress` |
| `in_progress` | `todo` |
| `in_progress` | `pending_review` |
| `in_progress` | `need_info` |
| `in_progress` | `blocked` |
| `blocked` | `in_progress` |
| `need_info` | `in_progress` |
| `pending_review` | `done` |
| `pending_review` | `in_progress` |

### Explicitly Forbidden Transitions (tested)

| From | To |
|------|----|
| `backlog` | `pending_review` |
| `backlog` | `done` |
| `backlog` | `in_progress` |
| `todo` | `done` |
| `need_info` | `done` |
| `done` | `in_progress` |

### Invariants
- All 7 same→same transitions (`backlog→backlog`, etc.) succeed.
- Any transition not in the allowed set fails — even if not in the explicitly forbidden list above.
- `done` is a terminal state — no outbound transitions are allowed.

## Behaviour

### Happy Path
1. If `from === to`, return `Effect.succeed(undefined)`.
2. Look up `from` in the allowed-transitions map.
3. If `to` is in the allowed set for `from`, return `Effect.succeed(undefined)`.
4. Otherwise return `Effect.fail({ _tag: 'transition_not_allowed', from, to })`.

### Edge Cases
- **Same→same**: always succeeds regardless of which status.
- **`done` as source**: no outbound transitions; any `to ≠ done` fails.
- **Unknown status values**: impossible — `Status` is a Zod enum; TypeScript prevents invalid values.

## Scenarios
```gherkin
Feature: guardTransition

  Scenario Outline: allowed transitions succeed
    Given from is <from> and to is <to>
    When guardTransition is called
    Then it returns succeed

    Examples:
      | from           | to             |
      | backlog        | todo           |
      | todo           | backlog        |
      | todo           | in_progress    |
      | in_progress    | todo           |
      | in_progress    | pending_review |
      | in_progress    | need_info      |
      | in_progress    | blocked        |
      | blocked        | in_progress    |
      | need_info      | in_progress    |
      | pending_review | done           |
      | pending_review | in_progress    |

  Scenario Outline: forbidden transitions fail
    Given from is <from> and to is <to>
    When guardTransition is called
    Then it fails with _tag "transition_not_allowed"
    And error.from is <from> and error.to is <to>

    Examples:
      | from    | to             |
      | backlog | pending_review |
      | backlog | done           |
      | backlog | in_progress    |
      | todo    | done           |
      | need_info | done         |
      | done    | in_progress    |

  Scenario Outline: same-to-same is always a no-op success
    Given from and to are both <status>
    When guardTransition is called
    Then it returns succeed

    Examples:
      | status         |
      | backlog        |
      | todo           |
      | need_info      |
      | blocked        |
      | in_progress    |
      | pending_review |
      | done           |
```

## Implementation Notes
- Pure function — represent the allowed graph as a `Record<Status, ReadonlySet<Status>>`.
- Same→same check must happen before the map lookup.
- Do NOT use a flat list of tuples — the map structure makes it O(1) and avoids iteration.
- This function is called inside `updateTask`; keep it free of side effects.

## Implementation Checklist
- [ ] Create `src/domain/status-machine.ts`
- [ ] Define allowed transitions as `Record<Status, ReadonlySet<Status>>`
- [ ] Implement `guardTransition` with same→same short-circuit
- [ ] Run `bun test tests/unit/domain/status-machine.test.ts`
- [ ] All scenarios pass (11 allowed + 6 forbidden + 7 same→same)

## Dependencies
- `@logbook/domain/types` — `Status`, `TaskError`
