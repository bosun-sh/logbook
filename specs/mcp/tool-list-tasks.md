---
id: mcp/tool-list-tasks
layer: mcp
status: draft
depends_on: [task/list-tasks, mcp/error-codes]
test_file: tests/integration/mcp/tool-list-tasks.test.ts
source_file: src/mcp/tool-list-tasks.ts
module_path: "@logbook/mcp/tool-list-tasks"
priority: 1
---

# MCP Tool: list_tasks

## Purpose
MCP tool that returns tasks filtered by status. Defaults to `in_progress` when no status is provided.

## Signature
```ts
// MCP tool registration
server.tool("list_tasks", ListTasksInputSchema, handler)
```

### Zod Input Schema
```ts
const ListTasksInputSchema = z.object({
  status: z.union([StatusSchema, z.literal('*')]).default('in_progress'),
})
type ListTasksInput = z.infer<typeof ListTasksInputSchema>
```

## Contract

### Inputs
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `status` | `Status \| '*'` | no | `'in_progress'` |

### Outputs
| Case | Response |
|------|----------|
| Success | `{ tasks: Task[] }` |
| Validation error (invalid status) | MCP error -32003 |

### Invariants
- When `status` is omitted, defaults to `'in_progress'`.
- Never fails with a domain error — `listTasks` returns `[]` on empty result.
- Input is validated by Zod before calling `listTasks`.

## Behaviour
1. Parse input with `ListTasksInputSchema`; return -32003 on parse failure.
2. Call `listTasks(input.status)`.
3. Return `{ tasks }` as MCP content.

## Scenarios
```gherkin
Feature: list_tasks MCP tool

  Scenario: no status → returns in_progress tasks
    Given 2 in_progress tasks and 1 backlog task
    When list_tasks is called with no status
    Then response contains 2 tasks with status in_progress

  Scenario: status '*' → returns all tasks
    When list_tasks({ status: '*' }) is called
    Then response contains all tasks

  Scenario: invalid status string → validation error
    When list_tasks({ status: 'invalid' }) is called
    Then MCP error code -32003 is returned
```

## Implementation Checklist
- [ ] Create `src/mcp/tool-list-tasks.ts`
- [ ] Register `list_tasks` tool with `ListTasksInputSchema`
- [ ] Wire handler to `listTasks` domain function
- [ ] Run `bun test tests/integration/mcp/tool-list-tasks.test.ts`
- [ ] All 3 scenarios pass

## Dependencies
- `@logbook/task/list-tasks` — `listTasks`
- `@logbook/mcp/error-codes` — error mapping
- `zod` — input validation
