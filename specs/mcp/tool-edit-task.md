---
id: mcp/tool-edit-task
layer: mcp
status: draft
depends_on: [task/edit-task, mcp/error-codes]
test_file: tests/integration/mcp/tool-edit-task.test.ts
source_file: src/mcp/tool-edit-task.ts
module_path: "@logbook/mcp/tool-edit-task"
priority: 3
---

# MCP Tool: edit_task

## Purpose
MCP tool that edits mutable fields of an existing task without changing its status.

## Signature
```ts
server.tool("edit_task", EditTaskInputSchema, handler)
```

### Zod Input Schema
```ts
const EditTaskInputSchema = z.object({
  id:                 z.string().min(1),
  title:              z.string().min(1).optional(),
  description:        z.string().min(1).optional(),
  definition_of_done: z.string().min(1).optional(),
  predictedKTokens:   z.number().positive().optional(),
})
type EditTaskMcpInput = z.infer<typeof EditTaskInputSchema>
```

## Contract

### Inputs
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` | yes | Task to edit |
| `title` | `string` | no | |
| `description` | `string` | no | |
| `definition_of_done` | `string` | no | |
| `predictedKTokens` | `number` | no | Must be within cap |

### Outputs
| Case | Response |
|------|----------|
| Success | `{ task: Task }` |
| `not_found` | MCP error -32001 |
| `validation_error` | MCP error -32003 |
| Input parse failure | MCP error -32003 |

### Invariants
- `status` is NOT an accepted field — Zod schema excludes it.
- At least one optional field should be provided (callers' responsibility; server doesn't enforce).

## Behaviour
1. Parse input; extract `id`, pass remaining fields to `editTask`.
2. Call `editTask(input.id, { title, description, definition_of_done, predictedKTokens })`.
3. On success: return `{ task }`.
4. On `TaskError`: map via `taskErrorToMcpError`.

## Scenarios
```gherkin
Feature: edit_task MCP tool

  Scenario: edits title
    When edit_task({ id, title: "New" }) is called
    Then response.task.title is "New"

  Scenario: predictedKTokens exceeds cap → error -32003
    Given task "t-1" exists
    When edit_task({ id: "t-1", predictedKTokens: 25 }) is called
    Then MCP error code -32003 is returned
    And error data contains message "predicted kilotokens exceed maximum allowed"

  Scenario: unknown id → error -32001
    When edit_task({ id: "ghost-id", title: "New" }) is called
    Then MCP error code -32001 is returned
    And error data contains taskId "ghost-id"
```

## Implementation Checklist
- [ ] Create `src/mcp/tool-edit-task.ts`
- [ ] Register `edit_task` tool with `EditTaskInputSchema`
- [ ] Extract `id`, pass remaining fields to `editTask`
- [ ] Run `bun test tests/integration/mcp/tool-edit-task.test.ts`
- [ ] All 3 scenarios pass

## Dependencies
- `@logbook/task/edit-task` — `editTask`
- `@logbook/mcp/error-codes` — `taskErrorToMcpError`
