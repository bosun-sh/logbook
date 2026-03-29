---
id: infra/hook-config-loader
layer: infra
status: draft
depends_on: [hook/hook-executor]
test_file: tests/e2e/hook-config-loader.test.ts
source_file: src/infra/hook-config-loader.ts
module_path: "@logbook/infra/hook-config-loader"
priority: 3
---

# hookConfigLoader

## Purpose
Scans the `hooks/` directory, parses each `config.yml`, and returns a list of `HookConfig` objects ready for `executeHooks`.

## Signature
```ts
import { Effect } from "effect"
import type { HookConfig } from "../hook/hook-executor.js"

export const loadHookConfigs = (
  hooksDir: string,
): Effect.Effect<readonly HookConfig[], never>
```

## Contract

### Inputs
| Param | Type | Notes |
|-------|------|-------|
| `hooksDir` | `string` | Path to the `hooks/` directory (e.g. `./hooks`) |

### Outputs
- Always `Effect.succeed(configs)` — errors in individual hook dirs are skipped, not propagated.
- Returns `[]` if `hooksDir` does not exist.

### HookConfig Fields Loaded from config.yml
| YAML key | Maps to | Required |
|----------|---------|----------|
| `event` | `config.event` | yes |
| `condition` | `config.condition` | no |
| `timeout_ms` | `config.timeout_ms` | no |

### script field
- `config.script` is set to the absolute path of `script.ts` (or `script.sh`) found in the hook subdirectory.
- Hook subdirectory MUST contain both `config.yml` and a script file.

### Directory Structure Expected
```
hooks/
└── <hook-name>/
    ├── config.yml    ← required
    └── script.ts     ← required (or script.sh)
```

### Invariants
- Each hook subdirectory is processed independently — one bad config skips that hook, others continue.
- `config.yml` is parsed with a Zod schema; invalid YAML or missing required fields cause the hook to be skipped (with a console warning).
- Returned array contains only valid, fully-resolved configs.
- Script path is resolved to an absolute path before being returned.

## Behaviour

### Algorithm
1. Read entries of `hooksDir`; return `[]` if directory absent.
2. For each subdirectory entry:
   a. Read `<hookDir>/config.yml`.
   b. Parse YAML into an object; skip if parse fails.
   c. Validate against Zod schema `{ event: z.string(), condition: z.string().optional(), timeout_ms: z.number().optional() }`.
   d. Find script file (`script.ts` or `script.sh`) in hookDir; skip if absent.
   e. Build `HookConfig` with resolved `script` path.
3. Return array of valid configs.

### Edge Cases
- **`hooksDir` does not exist**: return `[]`.
- **Subdirectory without `config.yml`**: skip silently.
- **`config.yml` missing `event`**: skip with warning.
- **No script file found**: skip with warning.
- **Multiple script files**: prefer `script.ts` over `script.sh`.

## Scenarios
```gherkin
Feature: loadHookConfigs

  Scenario: loads valid hook config
    Given hooks/my-hook/config.yml with event "task.status_changed"
    And hooks/my-hook/script.ts exists
    When loadHookConfigs("hooks") is called
    Then result contains 1 config with event "task.status_changed"

  Scenario: skips hook with missing config.yml
    Given hooks/bad-hook/ with only script.ts
    When loadHookConfigs is called
    Then bad-hook is not in the result

  Scenario: skips hook with invalid config.yml
    Given hooks/broken/config.yml with no "event" field
    When loadHookConfigs is called
    Then broken is not in the result

  Scenario: returns empty array when hooks/ dir absent
    When loadHookConfigs("nonexistent/") is called
    Then result is []

  Scenario: loads multiple hooks
    Given hooks/a/ and hooks/b/ both valid
    When loadHookConfigs is called
    Then result has 2 configs
```

## Implementation Notes
- Use `fs.readdir` with `{ withFileTypes: true }` to get subdirectories only.
- YAML parsing: use a lightweight parser (`yaml` npm package) — do not write a YAML parser.
- Script resolution: `path.resolve(hooksDir, hookName, 'script.ts')` — check existence before adding.
- This function is called once at server startup; performance is not critical.

## Implementation Checklist
- [ ] Create `src/infra/hook-config-loader.ts`
- [ ] Implement directory scanning, YAML parsing, Zod validation
- [ ] Resolve script paths to absolute paths
- [ ] Run `bun test tests/e2e/hook-config-loader.test.ts`
- [ ] All 5 scenarios pass

## Dependencies
- `@logbook/hook/hook-executor` — `HookConfig`
- `yaml` — YAML parsing
- `zod` — config validation
