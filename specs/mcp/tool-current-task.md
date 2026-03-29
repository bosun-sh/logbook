---
id: mcp/tool-current-task
layer: mcp
status: draft
depends_on: [task/current-task, mcp/session, mcp/error-codes]
test_file: tests/integration/mcp/tool-current-task.test.ts
source_file: src/mcp/tool-current-task.ts
module_path: "@logbook/mcp/tool-current-task"
priority: 1
---

# MCP Tool: current_task

## Purpose
MCP tool that returns the highest-priority (oldest) `in_progress` task for the current session. The session_id is injected by the server — callers pass no parameters.

## Signature
```ts
server.tool("current_task", CurrentTaskInputSchema, handler)
```

### Zod Input Schema
```ts
const CurrentTaskInputSchema = z.object({})
type CurrentTaskInput = z.infer<typeof CurrentTaskInputSchema>
```

## Contract

### Inputs
None — the tool takes no user-facing parameters.

### Outputs
| Case | Response |
|------|----------|
| Session has an in_progress task | `{ task: Task }` |
| No current task | MCP error -32006 |

### Invariants
- `session_id` is always taken from the server-side connection context — never from tool input.
- Returns the oldest in_progress task (FIFO by `in_progress_since`) for the calling session.

## Behaviour
1. Retrieve `session_id` from connection context.
2. Call `currentTask(session_id)`.
3. On success: return `{ task }`.
4. On `no_current_task`: return MCP error -32006.

## Scenarios
```gherkin
Feature: current_task MCP tool

  Scenario: returns oldest in_progress task for session
    Given session has an in_progress task
    When current_task is called
    Then response contains that task

  Scenario: no in_progress task → error -32006
    Given session has no in_progress tasks
    When current_task is called
    Then MCP error code -32006 is returned
```

## Implementation Checklist
- [ ] Create `src/mcp/tool-current-task.ts`
- [ ] Register `current_task` tool with empty input schema
- [ ] Inject `session_id` from connection context
- [ ] Run `bun test tests/integration/mcp/tool-current-task.test.ts`
- [ ] All 2 scenarios pass

## Dependencies
- `@logbook/task/current-task` — `currentTask`
- `@logbook/mcp/session` — session_id injection
- `@logbook/mcp/error-codes` — error mapping
