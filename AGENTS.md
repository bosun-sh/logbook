# Logbook CLI

File-system kanban board for AI agents.

## Commands

| Command | Description |
|---------|-------------|
| `logbook create-task` | Create a new task in backlog |
| `logbook list-tasks` | List tasks, optionally filtered by status |
| `logbook current-task` | Get current in-progress task for this session |
| `logbook update-task` | Transition task status |
| `logbook edit-task` | Edit task fields without changing status |
| `logbook init` | Initialize project |

## Task Lifecycle

`backlog → todo → in_progress → pending_review → done`

Side-exits: `in_progress → need_info`, `blocked` (return to `in_progress`)

## Usage Examples

### Create a task
```bash
logbook create-task --project myproject --milestone v1 --title "Fix bug" \
  --definition-of-done "Bug fixed and tested" --description "Details..." \
  --predicted-k-tokens 3
```

### List tasks
```bash
logbook list-tasks --status in_progress
logbook list-tasks --status "*"
logbook list-tasks --status todo --project myproject
```

### Get current task
```bash
logbook current-task
```

### Update task status
```bash
logbook update-task --id <uuid> --new-status in_progress
logbook update-task --id <uuid> --new-status need_info \
  --comment-title "Need info" --comment-content "What does X mean?"
```

### Edit task
```bash
logbook edit-task --id <uuid> --title "New title"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOGBOOK_TASKS_FILE` | `./tasks.jsonl` | Path to JSONL task store |
| `LOGBOOK_HOOKS_DIR` | `./hooks` | Directory for hook definitions |
| `LOGBOOK_SESSION_ID` | auto-generated | Session ID to use |
