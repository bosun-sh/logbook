# Quickstart: Running logbook in 2 minutes

1. **Prerequisites**
   - Node.js installed (for npm)
   - A supported platform binary will be downloaded with the package

2. **Install logbook**
   ```bash
   npm install -g @bosun-sh/logbook
   ```

3. **Configure your AI client**

   **Claude Code** — add to `.claude/settings.json`:
   ```json
   {
     "mcpServers": {
       "logbook": {
         "command": "logbook-mcp"
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
         "command": ["logbook-mcp"],
         "enabled": true
       }
     }
   }
   ```

4. **First run**
   ```bash
   LOGBOOK_TASKS_FILE=./tasks.jsonl logbook-mcp
   ```

5. **Verify**
   - Open your AI client
   - Call `current_task()`
   - Expected response: `no_current_task`

You're ready. Create your first task with `create_task()` to see it in your kanban.
