# logbook — kanban for ai agents

logbook is a file-system kanban board for autonomous AI agents. It tracks epics, stories, tasks, and context entries across a structured lifecycle so agents and humans share a single source of truth without context bloat.

→ **new here?** see [quickstart.md](quickstart.md) to get running in 5 minutes.

## why logbook

autonomous agents work in parallel, forget context across sessions, and have no shared task state. logbook solves three problems:

- **human visibility** — agents record every task they touch in a file the whole team can read and diff
- **agent coordination** — `task.current` resolves FIFO per-session, so multiple agents can't claim the same task
- **context budget** — structured JSONL with a DuckDB optional query layer lets agents find relevant records without loading the whole store

v2 adds: *epics → stories → tasks* hierarchy, reusable *context entries* (knowledge that survives across tasks), and Linear two-way sync as a first-class plugin.

## quickstart

```bash
bun add @bosun-sh/logbook            # install
logbook workspace:init               # scaffold .logbook/ in the current directory
logbook task:create \
  --title "Implement login endpoint" \
  --description "JWT auth, see docs/auth.md" \
  --definition-of-done "Tests pass and endpoint is documented" \
  --project myapp --milestone v1
logbook task:list --status "*"
```

see [quickstart.md](quickstart.md) for the full walkthrough including Linear sync.

## workspace layout

`workspace.init` creates the following structure:

```
.logbook/
├── config.json           # workspace config (Linear credentials, hook overrides)
├── workspace.json        # workspace metadata
├── hooks/
│   ├── review-spawn/     # spawns a reviewer agent on pending_review
│   │   ├── config.json
│   │   └── script.ts
│   └── need-info-notify/ # notifies user when a task needs info
│       ├── config.json
│       └── script.ts
└── storage/
    ├── epics.jsonl
    ├── stories.jsonl
    ├── tasks.jsonl
    ├── context-entries.jsonl
    ├── external-links.jsonl
    ├── sync-events.jsonl
    └── sync-conflicts.jsonl
```

add `.logbook/storage/` to `.gitignore` to keep runtime data out of version control:

```gitignore
.logbook/storage/
```

## mcp tools by plugin

connect `logbook-mcp` as an MCP server and call any of the 38 tools below.

### task plugin

| Tool ID | Purpose |
|---------|---------|
| `task.create` | Create a task in backlog |
| `task.get` | Load one task by id |
| `task.list` | List tasks (default status: `in_progress`) |
| `task.current` | Claim and return the highest-priority in-progress task for this session |
| `task.update` | Transition task status, add comments, reply to need_info |
| `task.edit` | Edit mutable fields without status change |
| `task.assign.session` | Assign a session to a task |
| `task.assign.model` | Assign a model to a task |
| `task.assign.phase-model` | Set a per-phase model override |
| `task.estimate` | Compute or re-compute a Fibonacci estimation |

`task.current` priority chain: session-owned in_progress → unassigned in_progress → orphaned in_progress (dead session) → highest-priority todo (auto-transitions) → `no_current_task` error.

### epic plugin

| Tool ID | Purpose |
|---------|---------|
| `epic.create` | Create an epic |
| `epic.get` | Load one epic |
| `epic.list` | List epics |
| `epic.update` | Update an epic |
| `epic.delete` | Tombstone an epic |

### story plugin

| Tool ID | Purpose |
|---------|---------|
| `story.create` | Create a story within an epic |
| `story.get` | Load one story |
| `story.list` | List stories |
| `story.update` | Update a story |
| `story.delete` | Tombstone a story |

### context plugin

| Tool ID | Purpose |
|---------|---------|
| `context.create` | Create a reusable context entry |
| `context.get` | Load one context entry |
| `context.list` | List context entries |
| `context.update` | Update a context entry |
| `context.delete` | Tombstone a context entry |
| `context.attach` | Attach a context entry to an epic, story, or task |
| `context.detach` | Remove an attachment |
| `context.search` | Full-text search over context entries |

### sync plugin (Linear)

| Tool ID | Purpose |
|---------|---------|
| `sync.linear.pull` | Pull issues from Linear into logbook (since-cursor pagination) |
| `sync.linear.push` | Push logbook tasks to Linear |
| `sync.linear.status` | Check Linear configuration and connectivity |
| `sync.conflicts.list` | List unresolved sync conflicts |
| `sync.conflicts.resolve` | Resolve a conflict (`use_local`, `use_remote`, or `manual`) |

### workspace plugin

| Tool ID | Purpose |
|---------|---------|
| `workspace.init` | Initialize or re-scaffold the `.logbook/` workspace |
| `workspace.status` | Report workspace health and provider status |

### hook plugin

| Tool ID | Purpose |
|---------|---------|
| `hook.list` | List registered hooks |
| `hook.run` | Run a hook manually |

### plugin plugin

| Tool ID | Purpose |
|---------|---------|
| `plugin.list` | List all registered plugins and their tool IDs |

## cli

every tool is available as `logbook <tool-id-with-colons>`:

```bash
# workspace
logbook workspace:init
logbook workspace:status

# tasks
logbook task:create --title "x" --description "y" --definition-of-done "z" --project p --milestone m
logbook task:list --status "*"
logbook task:list --status in_progress
logbook task:current
logbook task:update --id <uuid> --new-status pending_review
logbook task:edit --id <uuid> --title "New title"

# epics and stories
logbook epic:create --title "Auth" --description "Login and session management" --outcome "Users can log in"
logbook story:create --epic-id <uuid> --title "JWT login" --description "..." --user-value "Users can authenticate"

# context
logbook context:create --title "Auth spec" --body "Use JWT RS256. See docs/auth.md."
logbook context:attach --context-entry-id <uuid> --task-id <uuid>

# Linear sync
logbook sync:linear:pull
logbook sync:linear:push --dry-run
logbook sync:linear:status

# v1 aliases (still work, emit a compatibility warning)
logbook create-task --title "..." --definition-of-done "..." --predicted-k-tokens 3
logbook list-tasks --status in_progress
```

all commands write a single-line JSON envelope to stdout:

```json
{"ok":true,"data":{"task":{...}}}
{"ok":false,"error":{"code":"not_found","message":"task abc was not found"}}
```

## linear integration

### setup

1. create a Linear API key at **Linear → Settings → API → Personal API keys**
2. add it to your environment:
   ```bash
   export LINEAR_API_KEY=lin_api_...
   ```
3. declare the `linear` block in `.logbook/config.json`:
   ```json
   {
     "linear": {
       "apiTokenEnv": "LINEAR_API_KEY",
       "workspaceId": "your-workspace-id",
       "defaultTeamId": "your-team-id"
     }
   }
   ```

### pull / push

```bash
# pull issues from Linear since the last cursor
logbook sync:linear:pull

# pull with options
logbook sync:linear:pull --dry-run --team-id <id>

# push logbook tasks to Linear
logbook sync:linear:push

# push only specific tasks
logbook sync:linear:push --task-ids '["task_abc","task_xyz"]' --dry-run

# check status (connectivity + cursor position)
logbook sync:linear:status --check-provider
```

### conflicts

when the same record is modified in both logbook and Linear, a conflict entry is written to `sync-conflicts.jsonl`:

```bash
logbook sync:conflicts:list
logbook sync:conflicts:resolve --id <conflict-uuid> --resolution use_local
# resolutions: use_local | use_remote | manual
```

conflict states: `open` → `resolved` or `ignored`.

### external links

bidirectional `linear:<id>` mappings are stored in `external-links.jsonl` and updated automatically by pull/push.

## hooks

hooks execute shell commands on task lifecycle events. configuration lives in `.logbook/hooks/<id>/config.json`:

```json
{
  "id": "need-info-notify",
  "event": "task.status_changed",
  "condition": "new_status == 'need_info'",
  "command": ["bun", "run", ".logbook/hooks/need-info-notify/script.ts"],
  "timeoutMs": 5000
}
```

two hooks are materialized by `workspace.init`:

- **`need-info-notify`** — prints the blocking comment when a task moves to `need_info`
- **`review-spawn`** — creates a review task and spawns a reviewer agent when a task moves to `pending_review`

hooks are stateless — execute and forget. the `command` field is an argv array; no shell expansion is performed.

## environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGBOOK_WORKSPACE_ROOT` | `process.cwd()` | workspace root used by the compiled binaries |
| `LOGBOOK_LOG_LEVEL` | `warn` | log level: `debug`, `info`, `warn`, `error` |
| `LINEAR_API_KEY` | — | Linear API token (or the env var named in `linear.apiTokenEnv`) |

## optional duckdb index

logbook uses `@duckdb/node-api` to run ad-hoc SQL over the canonical JSONL files. the index is in-memory — no separate index file is written or maintained:

```sql
-- example: find all in_progress tasks for a specific project
SELECT id, title, status FROM read_json_auto('.logbook/storage/tasks.jsonl', format='newline_delimited')
WHERE status = 'in_progress' AND project = 'myapp'
```

the DuckDB path is opt-in via `workspace.status` and is non-canonical — the JSONL files remain the source of truth.

## migrating from v1

if your project has a `tasks.jsonl` at the repository root, `workspace.init` detects it and migrates all records to `.logbook/storage/tasks.jsonl` automatically:

- field names renamed from `snake_case` to `camelCase`
- `kind: "task"` injected on every record
- v1 comment shape converted to v2 shape

v1 CLI commands (`create-task`, `list-tasks`, `current-task`, `update-task`, `edit-task`, `init`) remain registered and emit a `compatibility_mapping_applied` warning. remove the deprecated commands from your scripts when ready.

see `CHANGELOG.md` for the full v2.0.0 breaking-change list.

## stack

- **runtime**: Bun / TypeScript
- **effect system**: Effect.ts — all async operations and errors modeled as `Effect<A, E, R>`
- **architecture**: ohtools plugin registry, hexagonal adapters (CLI + MCP), vertical slices per entity
- **persistence**: JSONL — append-only, one record per line, full-scan reads; DuckDB for optional ad-hoc queries
- **validation**: Zod at every public boundary (MCP input, CLI flags, filesystem reads)
