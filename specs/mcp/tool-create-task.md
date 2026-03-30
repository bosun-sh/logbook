---
id: mcp/tool-create-task
layer: mcp
status: draft
depends_on: [task/create-task, mcp/session, mcp/error-codes]
test_file: tests/integration/mcp/tool-create-task.test.ts
source_file: src/mcp/tool-create-task.ts
module_path: "@logbook/mcp/tool-create-task"
priority: 2
---

# MCP Tool: create_task

## Purpose
MCP tool that creates a new task in `backlog` status assigned to the calling session.

## Signature
```ts
server.tool("create_task", CreateTaskInputSchema, handler)
```

### Zod Input Schema
```ts
const CreateTaskInputSchema = z.object({
  project:            z.string().min(1),
  milestone:          z.string().min(1),
  title:              z.string().min(1),
  definition_of_done: z.string().min(1),
  description:        z.string().min(1),
  predictedKTokens:   z.number().positive(),
  priority:           z.number().int().min(0).default(0),
})
type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>
```

## Contract

### Inputs
| Field | Type | Required |
|-------|------|----------|
| `project` | `string` | yes | |
| `milestone` | `string` | yes | |
| `title` | `string` | yes | |
| `definition_of_done` | `string` | yes | |
| `description` | `string` | yes | |
| `predictedKTokens` | `number` | yes | |
| `priority` | `number` | no | integer ≥ 0; defaults to 0 |

### Outputs
| Case | Response |
|------|----------|
| Success | `{ task: Task }` |
| `validation_error` | MCP error -32003 |
| `conflict` | MCP error -32005 |
| Input parse failure | MCP error -32003 |

### Invariants
- `session_id` is injected from connection context — used as `assignee.id`.
- kTokens-to-Fibonacci mapping is performed inside `estimateFromKTokens`, called by `createTask`.

## Behaviour
1. Parse input; return -32003 on failure.
2. Call `createTask(input, session_id)`.
3. On success: return `{ task }`.
4. On `TaskError`: map via `taskErrorToMcpError`.

## Scenarios
```gherkin
Feature: create_task MCP tool

  Scenario: valid input creates task in backlog
    When create_task({ project, milestone, title, ... }) is called
    Then response contains task with status "backlog"
    And task.assignee.id equals session_id

  Scenario: predictedKTokens exceeds cap → error -32003
    Given a valid input except predictedKTokens is 21
    When create_task is called
    Then MCP error code -32003 is returned
    And error data contains message "predicted kilotokens exceed maximum allowed"

  Scenario: missing required field → error -32003
    Given input with title as empty string
    When create_task is called
    Then MCP error code -32003 is returned
```

## Implementation Checklist
- [ ] Create `src/mcp/tool-create-task.ts`
- [ ] Register `create_task` tool with `CreateTaskInputSchema`
- [ ] Inject `session_id` from connection context
- [ ] Run `bun test tests/integration/mcp/tool-create-task.test.ts`
- [ ] All 3 scenarios pass

## Dependencies
- `@logbook/task/create-task` — `createTask`
- `@logbook/mcp/session` — session_id
- `@logbook/mcp/error-codes` — `taskErrorToMcpError`
