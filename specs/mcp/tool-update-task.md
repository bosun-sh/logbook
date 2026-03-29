---
id: mcp/tool-update-task
layer: mcp
status: draft
depends_on: [task/update-task, mcp/session, mcp/error-codes]
test_file: tests/integration/mcp/tool-update-task.test.ts
source_file: src/mcp/tool-update-task.ts
module_path: "@logbook/mcp/tool-update-task"
priority: 2
---

# MCP Tool: update_task

## Purpose
MCP tool that transitions a task to a new status with an optional comment. Enforces all domain rules via `updateTask`.

## Signature
```ts
server.tool("update_task", UpdateTaskInputSchema, handler)
```

### Zod Input Schema
```ts
// Lighter input schema — auto-generates id and timestamp at the MCP boundary
const CommentInputSchema = z.object({
  title:   z.string().min(1),
  content: z.string(),
  kind:    CommentKindSchema,
  reply:   z.string().default(''),
})

const UpdateTaskInputSchema = z.object({
  id:         z.string().min(1),
  new_status: StatusSchema,
  comment:    CommentInputSchema.optional(),
})
type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>
```

## Contract

### Inputs
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | yes | Task to update |
| `new_status` | `Status` | yes | Target status |
| `comment` | `Comment` | no | Required for some transitions |

### Outputs
| Case | Response |
|------|----------|
| Success | `{ ok: true }` |
| `not_found` | MCP error -32001 |
| `transition_not_allowed` | MCP error -32002 |
| `validation_error` | MCP error -32003 |
| `missing_comment` | MCP error -32004 |
| `conflict` | MCP error -32005 |
| Input parse failure | MCP error -32003 |

### Invariants
- `session_id` is injected from connection context — not a tool parameter.
- `comment` is passed as `null` to `updateTask` when omitted from input.

## Behaviour
1. Parse input with `UpdateTaskInputSchema`; return -32003 on failure.
2. If `comment` is present, hydrate it into a full `Comment`: generate `id` via `crypto.randomUUID()` and set `timestamp` to `new Date()`.
3. Call `updateTask(input.id, input.new_status, hydratedComment ?? null, session_id)`.
3. On success: return `{ ok: true }`.
4. On `TaskError`: map to MCP error via `taskErrorToMcpError`.

## Scenarios
```gherkin
Feature: update_task MCP tool

  Scenario: valid transition succeeds
    When update_task({ id, new_status: 'todo' }) is called
    Then response is { ok: true }

  Scenario: not_found → error -32001
    Given no task with id "ghost-id" exists
    When update_task({ id: "ghost-id", new_status: "todo" }) is called
    Then MCP error code -32001 is returned
    And error data contains taskId "ghost-id"

  Scenario: transition_not_allowed → error -32002
    Given task "t-1" with status "backlog"
    When update_task({ id: "t-1", new_status: "done" }) is called
    Then MCP error code -32002 is returned
    And error data contains from "backlog" and to "done"

  Scenario: missing comment → error -32004
    Given task "t-1" with status "in_progress"
    When update_task({ id: "t-1", new_status: "need_info" }) is called without comment
    Then MCP error code -32004 is returned

  Scenario: missing id field → error -32003 (parse failure)
    When update_task({ new_status: "todo" }) is called without id
    Then MCP error code -32003 is returned
```

## Implementation Checklist
- [ ] Create `src/mcp/tool-update-task.ts`
- [ ] Register `update_task` tool with `UpdateTaskInputSchema`
- [ ] Map `comment ?? null` and inject `session_id`
- [ ] Run `bun test tests/integration/mcp/tool-update-task.test.ts`
- [ ] All 5 scenarios pass

## Dependencies
- `@logbook/task/update-task` — `updateTask`
- `@logbook/mcp/session` — session_id
- `@logbook/mcp/error-codes` — `taskErrorToMcpError`
- `@logbook/domain/types` — `StatusSchema`, `CommentSchema`
