---
id: domain/fibonacci
layer: domain
status: ready
depends_on: [domain/types]
test_file: tests/unit/domain/fibonacci.test.ts
source_file: src/domain/fibonacci.ts
module_path: "@logbook/domain/fibonacci"
priority: 2
---

# validateFibonacci

## Purpose
Validates that a number is a positive Fibonacci number, failing with a typed error otherwise.

## Signature
```ts
import { Effect } from "effect"
import type { TaskError } from "./types.js"

export const validateFibonacci = (n: number): Effect.Effect<void, TaskError>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `n` | `number` | Any numeric value |

### Outputs
| Case | Return |
|------|--------|
| `n` is in `{1, 2, 3, 5, 8, 13, 21, 34, 55, ...}` | `Effect.succeed(void)` |
| `n` is not a positive Fibonacci number | `Effect.fail({ _tag: 'validation_error', message: 'estimation must be a Fibonacci number' })` |

### Valid set (tested)
`[1, 2, 3, 5, 8, 13, 21, 34, 55]`

### Invalid set (tested)
`[4, 6, 0, -1, 1.5]`

### Invariants
- The error message must be exactly `'estimation must be a Fibonacci number'` — other modules match on this string.
- Floating-point values (e.g. `1.5`) are invalid even if they happen to be close to a Fibonacci number.
- Zero and negatives are invalid.

## Behaviour

### Happy Path
1. Check whether `n` is a positive integer.
2. Check whether `n` appears in the Fibonacci sequence.
3. Return `Effect.succeed(undefined)`.

### Edge Cases
- **Zero**: fails — not positive.
- **Negative**: fails — not positive.
- **Float**: fails — not an integer.
- **Large Fibonacci**: implementation MUST handle values above 55 (sequence is infinite); use mathematical check `5n²±4` is a perfect square.

## Scenarios
```gherkin
Feature: validateFibonacci

  Scenario Outline: valid Fibonacci values succeed
    Given n is <value>
    When validateFibonacci is called
    Then it returns succeed

    Examples:
      | value |
      | 1     |
      | 2     |
      | 3     |
      | 5     |
      | 8     |
      | 13    |
      | 21    |
      | 34    |
      | 55    |

  Scenario Outline: invalid values fail with validation_error
    Given n is <value>
    When validateFibonacci is called
    Then it fails with _tag "validation_error"
    And message is "estimation must be a Fibonacci number"

    Examples:
      | value |
      | 4     |
      | 6     |
      | 0     |
      | -1    |
      | 1.5   |
```

## Implementation Notes
- Pure function — no I/O, no Effect dependencies beyond the return type.
- Preferred algorithm: a number `n` is Fibonacci iff `5n²+4` or `5n²-4` is a perfect square.
- Do NOT hardcode a lookup table — it would need extending and violates the infinite-sequence invariant.
- The function is used by `createTask` and `editTask` before persisting; keep it free of side effects.

## Implementation Checklist
- [ ] Create `src/domain/fibonacci.ts`
- [ ] Implement `validateFibonacci` using the `5n²±4` perfect square check
- [ ] Run `bun test tests/unit/domain/fibonacci.test.ts`
- [ ] All 14 scenarios pass (9 valid + 5 invalid)

## Dependencies
- `@logbook/domain/types` — `TaskError`
