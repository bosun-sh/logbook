---
id: mcp/server
layer: mcp
status: draft
depends_on: [mcp/session, mcp/tool-list-tasks, mcp/tool-current-task, mcp/tool-update-task, mcp/tool-create-task, mcp/tool-edit-task, mcp/error-codes, infra/jsonl-task-repository, infra/hook-config-loader, hook/hook-executor]
test_file: tests/integration/mcp/server.test.ts
source_file: src/mcp/server.ts
module_path: "@logbook/mcp/server"
priority: 1
---

# MCP Server Bootstrap

## Purpose
Bootstraps the MCP server: wires the Effect.ts layer graph, registers all tools, manages session lifecycle, and maps domain errors to MCP error responses.

## Signature
```ts
// src/mcp/server.ts
export const startServer = (): Promise<void>
```

## Contract

### Environment Variables
| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `LOGBOOK_TASKS_FILE` | no | `./tasks.jsonl` | Path to the JSONL task store |
| `LOGBOOK_HOOKS_DIR` | no | `./hooks` | Path to hooks directory |
| `REVIEWER_AGENT_URL` | no | — | Remote reviewer endpoint (see review-agent-config) |

### Server Startup Sequence
1. Read `LOGBOOK_TASKS_FILE` from env (default `./tasks.jsonl`).
2. Read `LOGBOOK_HOOKS_DIR` from env (default `./hooks`).
3. Call `loadHookConfigs(hooksDir)` to load all hook configs.
4. Construct `JsonlTaskRepository(tasksFile)`.
5. Construct `HookRunner` backed by `executeHooks(event, hookConfigs)`.
6. Register MCP tools: `list_tasks`, `current_task`, `update_task`, `create_task`, `edit_task`.
7. Start listening on stdio (MCP stdio transport).

### Session Lifecycle
1. On client connection: generate `session_id = crypto.randomUUID()`.
2. Build per-session `Layer`:
   ```ts
   Layer.merge(
     Layer.succeed(TaskRepository, repository),
     Layer.succeed(HookRunner, hookRunner),
   )
   ```
3. Inject `session_id` into tool handler closures for this connection.
4. On disconnect: connection ends; no cleanup required (MVP).

### Layer Wiring
```ts
const repository = new JsonlTaskRepository(tasksFile)
const hookRunner: HookRunner = {
  run: (event) => executeHooks(event, hookConfigs),
}
const layer = Layer.merge(
  Layer.succeed(TaskRepository, repository),
  Layer.succeed(HookRunner, hookRunner),
)
```

### Error Handling
- Domain errors (`TaskError`): caught per tool handler, mapped to MCP errors via `taskErrorToMcpError`.
- Defects (`Effect.die`): caught at server level with `Effect.catchAllDefect`; mapped to MCP error -32000.
- Unhandled exceptions: caught in `process.on('uncaughtException')`; log and continue.

### Invariants
- The `repository` instance is shared across all sessions (single writer for JSONL).
- `hookConfigs` are loaded once at startup; no hot-reloading in MVP.
- Each tool handler runs its Effect in the per-session layer.
- `session_id` is never exposed to clients as a parameter.

## Tool Registration Pattern
```ts
server.tool("list_tasks", ListTasksInputSchema, async (input) => {
  const effect = listTasks(input.status).pipe(
    Effect.map(tasks => ({ tasks })),
    Effect.catchAll(err => Effect.fail(taskErrorToMcpError(err))),
  )
  return Effect.runPromise(Effect.provide(effect, layer))
})
```

## Scenarios
```gherkin
Feature: MCP server bootstrap

  Scenario: server starts and accepts connections
    Given LOGBOOK_TASKS_FILE is set
    When startServer() is called
    Then server is listening on stdio

  Scenario: session_id is unique per connection
    Given two simultaneous connections
    Then each connection has a different session_id

  Scenario: domain error returns structured MCP error
    Given a tool call that triggers not_found
    Then MCP response contains error code -32001

  Scenario: defect returns internal server error
    Given a tool call that triggers Effect.die
    Then MCP response contains error code -32000
```

## Implementation Notes
- MCP SDK: use `@modelcontextprotocol/sdk` — follow its stdio server pattern.
- Entry point: `src/mcp/server.ts` — this file does not yet exist; create it.
- Do NOT import from test helpers in production code.
- Single `repository` instance is intentional — JSONL is single-writer by design.

## Implementation Checklist
- [ ] Create `src/mcp/server.ts`
- [ ] Wire Effect.ts layer graph: `JsonlTaskRepository` + `HookRunner`
- [ ] Register all 5 MCP tools
- [ ] Implement session lifecycle with `crypto.randomUUID()`
- [ ] Map domain errors and defects to MCP error responses
- [ ] Run `bun test tests/integration/mcp/server.test.ts`
- [ ] All 4 scenarios pass

## Dependencies
- `@modelcontextprotocol/sdk` — MCP server, tool registration, stdio transport
- `@logbook/infra/jsonl-task-repository` — `JsonlTaskRepository`
- `@logbook/infra/hook-config-loader` — `loadHookConfigs`
- `@logbook/hook/hook-executor` — `executeHooks`
- `@logbook/task/*` — all task use cases
- `@logbook/mcp/error-codes` — `taskErrorToMcpError`
