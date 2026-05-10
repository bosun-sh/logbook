# logbook

File-system kanban board for autonomous AI agents. Tracks epics, stories, tasks, and context entries so agents and humans share a single source of truth without context bloat.

## Entity Hierarchy

```
epic → story → task
               task → context entries (attached)
```

All entities are stored as newline-delimited JSONL in `.logbook/storage/`:

| File | Entity |
|------|--------|
| `epics.jsonl` | Epic |
| `stories.jsonl` | Story |
| `tasks.jsonl` | Task |
| `context-entries.jsonl` | ContextEntry |
| `external-links.jsonl` | ExternalLink (bidirectional sync mapping) |
| `sync-events.jsonl` | SyncEvent |
| `sync-conflicts.jsonl` | SyncConflict |

## CLI Usage

All v2 commands use colon-separated tool IDs:

```bash
logbook workspace:init
logbook workspace:status

logbook task:create --title "x" --description "y" \
  --definition-of-done "z" --project p --milestone m
logbook task:list --status "*"
logbook task:current
logbook task:update --id <uuid> --new-status in_progress
logbook task:edit --id <uuid> --title "New title"

logbook epic:create --title "Auth" --description "..." --outcome "..."
logbook story:create --epic-id <uuid> --title "..." --description "..." --user-value "..."

logbook context:create --title "..." --body "..."
logbook context:attach --context-entry-id <uuid> --task-id <uuid>

logbook sync:linear:pull
logbook sync:linear:push --dry-run
logbook sync:linear:status --check-provider

logbook hook:list
```

v1 aliases (`create-task`, `list-tasks`, etc.) remain registered and emit a `compatibility_mapping_applied` warning.

## MCP Tools

38 tools registered across 8 plugins. All use dotted lowercase IDs (`task.create`, `sync.linear.pull`, etc.).

| Plugin | Tool IDs |
|--------|---------|
| task | `task.create`, `task.get`, `task.list`, `task.current`, `task.update`, `task.edit`, `task.assign.session`, `task.assign.model`, `task.assign.phase-model`, `task.estimate` |
| epic | `epic.create`, `epic.get`, `epic.list`, `epic.update`, `epic.delete` |
| story | `story.create`, `story.get`, `story.list`, `story.update`, `story.delete` |
| context | `context.create`, `context.get`, `context.list`, `context.update`, `context.delete`, `context.attach`, `context.detach`, `context.search` |
| sync | `sync.linear.pull`, `sync.linear.push`, `sync.linear.status`, `sync.conflicts.list`, `sync.conflicts.resolve` |
| workspace | `workspace.init`, `workspace.status` |
| hook | `hook.list`, `hook.run` |
| plugin | `plugin.list` |

All inputs are object-rooted and reject unknown fields. All outputs are `ToolResult<T>` envelopes:

```ts
{ ok: true, data: T, warnings?: ToolWarning[] }
{ ok: false, error: { code: string, message: string, details?: Record<string, unknown> } }
```

## Stack

- **Runtime**: Bun / TypeScript
- **Effect system**: Effect.ts — all async operations and errors modeled as `Effect<A, E, R>`
- **Architecture**: ohtools plugin registry, hexagonal adapters (CLI + MCP), vertical slices per entity
- **Validation**: Zod at every system boundary (MCP input, CLI flags, filesystem reads)
- **Persistence**: JSONL — append-only, one record per line; DuckDB for optional ad-hoc queries

## Hooks

JSON config + argv command array in `.logbook/hooks/<id>/`:

```json
{
  "id": "review-spawn",
  "event": "task.status_changed",
  "condition": "new_status == 'pending_review'",
  "command": ["bun", "run", ".logbook/hooks/review-spawn/script.ts"],
  "timeoutMs": 5000
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGBOOK_WORKSPACE_ROOT` | `process.cwd()` | workspace root used by compiled binaries |
| `LOGBOOK_LOG_LEVEL` | `warn` | log level: `debug`, `info`, `warn`, `error` |
| `LINEAR_API_KEY` | — | Linear API token (or the var named in `linear.apiTokenEnv`) |

## Project Constitution

@rules/tigerstyle.md
@rules/functional-core.md
@rules/negative-space.md
@rules/dry.md
@rules/solid.md
@rules/clean-code.md
@rules/developer-experience.md
@rules/quality-gates.md
