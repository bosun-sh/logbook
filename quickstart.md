# quickstart: logbook in 5 minutes

## 1. install

```bash
npm install -g @bosun-sh/logbook
# or
bunx @bosun-sh/logbook --help
```

the published CLI runs on Node.js; no Bun install is required for runtime.

## 2. initialize the workspace

```bash
logbook init
```

this creates `.logbook/` in the current directory with `config.json`, `workspace.json`, a `storage/` directory, and the `review-spawn` and `need-info-notify` hook templates. it also offers to configure your detected MCP client and optionally set up Linear sync.

add `.logbook/storage/` to `.gitignore`:

```gitignore
.logbook/storage/
```

## 3. connect to your ai client

`logbook init` can write the MCP config for detected clients. if you skipped that step, add one of these manually:

**Claude Code** — add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "logbook": {
      "command": "logbook",
      "args": ["mcp"]
    }
  }
}
```

**OpenCode** — add to `opencode.json`:

```json
{
  "mcp": {
    "logbook": {
      "type": "local",
      "command": ["logbook", "mcp"],
      "enabled": true
    }
  }
}
```

## 4. create your first task

```bash
logbook task:create \
  --title "Implement login endpoint" \
  --description "JWT RS256 auth. See docs/auth.md for the spec." \
  --definition-of-done "Endpoint returns 200 for valid credentials; tests pass" \
  --project myapp \
  --milestone v1
```

output:

```json
{"ok":true,"data":{"task":{"id":"task_...","status":"backlog","title":"Implement login endpoint",...}}}
```

## 5. list tasks

```bash
logbook task:list --status "*"    # all statuses
logbook task:list --status in_progress
```

## 6. check the current task (as an agent would)

```bash
logbook task:current
```

if no task is `in_progress`, this transitions the highest-priority `todo` task automatically. returns a `no_current_task` error if nothing is available.

## 7. move a task through the lifecycle

```bash
# start work
logbook task:update --id <uuid> --new-status in_progress

# submit for review
logbook task:update --id <uuid> --new-status pending_review

# mark done
logbook task:update --id <uuid> --new-status done
```

## optional: linear sync

`logbook init` can run this setup interactively. if you skipped it, configure Linear separately:

1. add your Linear API key to `.env` or export it in your shell:

   ```bash
   echo "LINEAR_API_KEY=lin_api_..." >> .env
   ```

2. configure Logbook from your Linear team URL:

   ```bash
   logbook sync:linear:setup --team-url https://linear.app/bosun/team/BOSUN
   ```

   Or use explicit ids:

   ```bash
   logbook sync:linear:setup --workspace-id <workspace-id> --team-id <team-id>
   ```

   This writes the public `linear` block to `.logbook/config.json`:

   ```json
   {
     "linear": {
       "apiTokenEnv": "LINEAR_API_KEY",
       "workspaceId": "your-workspace-id",
       "defaultTeamId": "your-team-id"
     }
   }
   ```

3. pull issues from Linear:

   ```bash
   logbook sync:linear:pull --dry-run   # preview without writing
   logbook sync:linear:pull             # pull and write
   ```

4. push tasks back to Linear:

   ```bash
   logbook sync:linear:push --dry-run
   logbook sync:linear:push
   ```

5. check sync status:

   ```bash
   logbook sync:linear:status --check-provider
   ```

When you use Logbook through MCP, agent tool calls automatically pull fresh Linear changes before task-facing work and push successful task updates back to Linear.

---

that's it. from here:
- see `README.md` for the full MCP tool reference
- see the **Migrating from v1** section in `README.md` if you're migrating from v1
