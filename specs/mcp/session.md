---
id: mcp/session
layer: mcp
status: draft
depends_on: []
test_file: none
source_file: src/mcp/session.ts
module_path: "@logbook/mcp/session"
referenced_by: [mcp/server]
priority: 1
---

# Session Contract

## Purpose
Defines how `session_id` is generated and scoped within the MCP server. Each MCP connection is a distinct agent instance with an isolated session.

## Contract

### session_id Generation
- On each new MCP client connection, the server generates a `session_id` using `crypto.randomUUID()`.
- The `session_id` is never provided by the client — it is always server-assigned.
- The `session_id` is injected into all tool handlers for the duration of the connection.

### Scope
| Concept | Scoped by session_id |
|---------|---------------------|
| `current_task` | Returns oldest in_progress task for THIS session only |
| `update_task` concurrent guard | Counts in_progress tasks for THIS session only |
| `createTask` assignee | Sets `assignee.id = session_id` |

### Lifecycle
1. Client connects → server generates `session_id`.
2. All tool calls on this connection share the same `session_id`.
3. Client disconnects → session ends. No cleanup of in_progress tasks (orphan handling is post-MVP).

### Invariants
- `session_id` is a UUID — non-empty, unique per connection.
- `session_id` is never exposed as a tool parameter — callers never pass it explicitly.
- Two simultaneous connections have different `session_id` values.

## Implementation Notes
- Use `crypto.randomUUID()` at connection time; store in closure or context passed to tool handlers.
- The MCP SDK provides connection lifecycle hooks — generate the id in the connection handler.
- See `mcp/server.md` for how `session_id` is wired into the Layer.

## Implementation Checklist
- [ ] Create `src/mcp/session.ts`
- [ ] Implement `crypto.randomUUID()` session generation
- [ ] Export session creation function for use by server bootstrap

## Dependencies
- `mcp/server` — wires session_id into tool contexts
