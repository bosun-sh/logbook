---
id: domain/kTokens
layer: domain
status: draft
depends_on: [domain/types, domain/fibonacci]
test_file: tests/unit/domain/kTokens.test.ts
source_file: src/domain/kTokens.ts
module_path: "@logbook/domain/kTokens"
priority: 2
---

# estimateFromKTokens

## Purpose
Maps a predicted kilotoken count to the nearest Fibonacci bucket, using a configurable ratio. Caps at a maximum kilotoken threshold — tasks exceeding the cap are rejected as too large.

## Signature
```ts
import { Effect } from "effect"
import type { TaskError } from "./types.js"

export interface KTokensConfig {
  readonly anchorPoint:     number  // Fibonacci number that serves as the anchor
  readonly kTokensAtAnchor: number  // kilotokens at the anchor point
  readonly maxKTokens:      number  // cap — reject above this
}

export const defaultConfig: KTokensConfig

export const estimateFromKTokens = (
  kTokens: number,
  config?: KTokensConfig,
): Effect.Effect<number, TaskError>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `kTokens` | `number` | Predicted kilotoken count for the task |
| `config` | `KTokensConfig` | Optional; defaults to `defaultConfig` |

### defaultConfig
| Field | Value |
|-------|-------|
| `anchorPoint` | `8` |
| `kTokensAtAnchor` | `20` |
| `maxKTokens` | `20` |

Ratio = `kTokensAtAnchor / anchorPoint` = `20 / 8` = `2.5` kTokens per Fibonacci point.

### Outputs
| Case | Return |
|------|--------|
| `kTokens` within cap, maps to Fibonacci | `Effect.succeed(fibonacciNumber)` |
| `kTokens > maxKTokens` | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens exceed maximum allowed' })` |
| `kTokens <= 0` | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens must be positive' })` |
| `kTokens` is not a number | `Effect.fail({ _tag: 'validation_error', message: 'predicted kilotokens must be a number' })` |

### Invariants
- Returned value is always a positive Fibonacci number in `{1, 2, 3, 5, 8, 13, 21, 34, 55, ...}`.
- The mapping is: `nearestFibonacci(kTokens / ratio)` where `ratio = kTokensAtAnchor / anchorPoint`.
- When `kTokens` falls equidistant between two Fibonacci numbers, round UP to the higher one (conservative estimate).
- The function is pure — no I/O, no side effects.
- `config` is immutable; callers cannot mutate `defaultConfig`.

### Mapping Table (default config)

| kTokens | ÷ 2.5 | Nearest Fibonacci |
|---------|-------|-------------------|
| 1       | 0.4   | 1                 |
| 2       | 0.8   | 1                 |
| 3       | 1.2   | 1                 |
| 4       | 1.6   | 2                 |
| 5       | 2.0   | 2                 |
| 6       | 2.4   | 2                 |
| 7       | 2.8   | 3                 |
| 8       | 3.2   | 3                 |
| 9       | 3.6   | 5                 |
| 10      | 4.0   | 5                 |
| 12      | 4.8   | 5                 |
| 14      | 5.6   | 5                 |
| 15      | 6.0   | 5                 |
| 16      | 6.4   | 5                 |
| 17      | 6.8   | 8                 |
| 18      | 7.2   | 8                 |
| 20      | 8.0   | 8                 |

## Behaviour

### Happy Path
1. Check `kTokens` is a finite number; fail with `validation_error` otherwise.
2. Check `kTokens > 0`; fail with `validation_error` otherwise.
3. Check `kTokens <= config.maxKTokens`; fail with `validation_error` otherwise.
4. Compute `scaled = kTokens / (config.kTokensAtAnchor / config.anchorPoint)`.
5. Find the nearest Fibonacci number to `scaled` (round up on tie).
6. Return `Effect.succeed(fibonacciNumber)`.

### Edge Cases
- **Exactly at cap** (`kTokens === maxKTokens`): succeeds — cap is exclusive upper bound.
- **Fractional kTokens** (e.g. `3.5`): valid — the input can be fractional; only the output must be a Fibonacci integer.
- **Very small kTokens** (`0.1`): maps to Fibonacci 1 (the minimum positive Fibonacci).
- **Zero or negative**: fails immediately before any computation.

## Scenarios
```gherkin
Feature: estimateFromKTokens

  Scenario Outline: valid kTokens map to nearest Fibonacci
    Given kTokens is <kTokens>
    When estimateFromKTokens is called with default config
    Then it returns <fibonacci>

    Examples:
      | kTokens | fibonacci |
      | 1       | 1         |
      | 3       | 1         |
      | 5       | 2         |
      | 7       | 3         |
      | 10      | 5         |
      | 15      | 5         |
      | 18      | 8         |
      | 20      | 8         |

  Scenario Outline: kTokens exceeding cap → validation_error
    Given kTokens is <kTokens>
    When estimateFromKTokens is called with default config
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens exceed maximum allowed"

    Examples:
      | kTokens |
      | 21      |
      | 50      |
      | 100     |

  Scenario: zero kTokens → validation_error
    Given kTokens is 0
    When estimateFromKTokens is called
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens must be positive"

  Scenario: negative kTokens → validation_error
    Given kTokens is -5
    When estimateFromKTokens is called
    Then it fails with _tag "validation_error"
    And message is "predicted kilotokens must be positive"

  Scenario: fractional kTokens are valid
    Given kTokens is 3.5
    When estimateFromKTokens is called with default config
    Then it returns a Fibonacci number

  Scenario: custom config changes the ratio
    Given config is { anchorPoint: 5, kTokensAtAnchor: 10, maxKTokens: 30 }
    And kTokens is 10
    When estimateFromKTokens is called
    Then it returns 5
```

## Implementation Notes
- Reuse `validateFibonacci` from `@logbook/domain/fibonacci` if needed for output validation, but the mapping logic itself should compute the nearest Fibonacci directly.
- Nearest-Fibonacci algorithm: precompute or generate the Fibonacci sequence up to the max scaled value, then find the closest match.
- The function is called inside `createTask` and `editTask` before persisting; keep it free of side effects.
- `KTokensConfig` is exported so callers (including tests) can construct custom configs.

## Implementation Checklist
- [ ] Create `src/domain/kTokens.ts`
- [ ] Define `KTokensConfig` interface and `defaultConfig`
- [ ] Implement `estimateFromKTokens` with validation and nearest-Fibonacci mapping
- [ ] Run `bun test tests/unit/domain/kTokens.test.ts`
- [ ] All scenarios pass (8 valid mappings + 3 over-cap + 1 zero + 1 negative + 1 fractional + 1 custom config)

## Dependencies
- `@logbook/domain/types` — `TaskError`
- `@logbook/domain/fibonacci` — `validateFibonacci` (optional, for output validation)
