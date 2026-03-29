---
id: mcp/error-codes
layer: mcp
status: draft
depends_on: [domain/types]
test_file: tests/unit/mcp/error-codes.test.ts
source_file: src/mcp/error-codes.ts
module_path: "@logbook/mcp/error-codes"
priority: 1
---

# TaskError → MCP Error Mapping

## Purpose
Defines the canonical mapping from `TaskError._tag` values to structured MCP error responses, ensuring AI callers receive predictable, parseable error shapes.

## Contract

### Error Response Shape
```ts
interface McpErrorResponse {
  code:    number   // MCP error code
  message: string   // human-readable
  data?:   unknown  // structured payload for programmatic use
}
```

### Mapping Table

| `TaskError._tag` | MCP code | message | data |
|-----------------|----------|---------|------|
| `not_found` | `-32001` | `"Task not found"` | `{ taskId: string }` |
| `transition_not_allowed` | `-32002` | `"Status transition not allowed"` | `{ from: Status, to: Status }` |
| `validation_error` | `-32003` | `"Validation error"` | `{ message: string }` |
| `missing_comment` | `-32004` | `"A comment is required for this transition"` | `{}` |
| `conflict` | `-32005` | `"Task already exists"` | `{ taskId: string }` |
| `no_current_task` | `-32006` | `"No current task for this session"` | `{}` |

### Defects (Effect.die)
| Source | MCP code | message |
|--------|----------|---------|
| `Effect.die` / unhandled | `-32000` | `"Internal server error"` |

### Invariants
- Every `TaskError._tag` MUST have a mapping — no unmapped errors.
- Domain errors (codes -32001 to -32006) are separate from defects (-32000).
- The `data` field provides enough context for an AI caller to take corrective action without parsing the message string.
- MCP codes use the range -32001 to -32099 for application errors (below -32000 is reserved by JSON-RPC for protocol errors).

## Implementation Notes
- Implement as a pure function `taskErrorToMcpError(err: TaskError): McpErrorResponse`.
- Called in each tool handler's error channel before returning the MCP response.
- `Effect.die` defects are caught at the MCP server level (not in individual tool handlers) and mapped to -32000.

## Example
```ts
// Tool handler error mapping
Effect.catchAll(effect, (err: TaskError) =>
  Effect.fail(taskErrorToMcpError(err))
)
```

## Implementation Checklist
- [ ] Create `src/mcp/error-codes.ts`
- [ ] Implement `taskErrorToMcpError` pure function with all 6 tag mappings
- [ ] Run `bun test tests/unit/mcp/error-codes.test.ts`
- [ ] All 6 tag mappings return correct code, message, and data

## Dependencies
- `@logbook/domain/types` — `TaskError`, `Status`
