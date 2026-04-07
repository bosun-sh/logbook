import { access, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

const CLI_DOC_CONTENT = `# Logbook CLI

File-system kanban board for AI agents.

## Commands

| Command | Description |
|---------|-------------|
| \`logbook create-task\` | Create a new task in backlog |
| \`logbook list-tasks\` | List tasks, optionally filtered by status |
| \`logbook current-task\` | Get current in-progress task for this session |
| \`logbook update-task\` | Transition task status |
| \`logbook edit-task\` | Edit task fields without changing status |
| \`logbook init\` | Initialize project |

## Task Lifecycle

\`backlog → todo → in_progress → pending_review → done\`

Side-exits: \`in_progress → need_info\`, \`blocked\` (return to \`in_progress\`)

## Usage Examples

### Create a task
\`\`\`bash
logbook create-task --project myproject --milestone v1 --title "Fix bug" \\
  --definition-of-done "Bug fixed and tested" --description "Details..." \\
  --predicted-k-tokens 3
\`\`\`

### List tasks
\`\`\`bash
logbook list-tasks --status in_progress
logbook list-tasks --status "*"
logbook list-tasks --status todo --project myproject
\`\`\`

### Get current task
\`\`\`bash
logbook current-task
\`\`\`

### Update task status
\`\`\`bash
logbook update-task --id <uuid> --new-status in_progress
logbook update-task --id <uuid> --new-status need_info \\
  --comment-title "Need info" --comment-content "What does X mean?"
\`\`\`

### Edit task
\`\`\`bash
logbook edit-task --id <uuid> --title "New title"
\`\`\`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| \`LOGBOOK_TASKS_FILE\` | \`./tasks.jsonl\` | Path to JSONL task store |
| \`LOGBOOK_HOOKS_DIR\` | \`./hooks\` | Directory for hook definitions |
| \`LOGBOOK_SESSION_ID\` | auto-generated | Session ID to use |
`

const CLAUDE_CODE_SNIPPET = `Claude Code — add to .claude/settings.json:
{
  "mcpServers": {
    "logbook": {
      "command": "logbook-mcp"
    }
  }
}`

const OPENCODE_SNIPPET = `OpenCode — add to opencode.json:
{
  "mcp": {
    "logbook": {
      "type": "local",
      "command": ["logbook-mcp"],
      "enabled": true
    }
  }
}`

const GITIGNORE_SNIPPET = `.gitignore — add these runtime files:
tasks.jsonl
sessions.json
.logbook-session`

const NEXT_STEPS = `Next steps:
  1. Add the config snippet for your AI client (MCP) or use CLI directly
  2. Run: LOGBOOK_TASKS_FILE=./tasks.jsonl logbook init
  3. See AGENTS.md for CLI commands reference
  4. See quickstart.md for the full walkthrough`

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const isSymlink = async (path: string): Promise<boolean> => {
  try {
    const stats = await lstat(path)
    return stats.isSymbolicLink()
  } catch {
    return false
  }
}

const scaffoldTasksFile = async (cwd: string): Promise<void> => {
  const path = join(cwd, "tasks.jsonl")
  if (await fileExists(path)) {
    console.log("✓ tasks.jsonl already exists, skipping")
    return
  }
  await writeFile(path, "", "utf8")
  console.log("✓ tasks.jsonl created")
}

const scaffoldHooksDir = async (cwd: string): Promise<void> => {
  const path = join(cwd, "hooks")
  if (await fileExists(path)) {
    console.log("✓ hooks/ already exists, skipping")
    return
  }
  await mkdir(path, { recursive: false })
  console.log("✓ hooks/ created")
}

const appendLogbookDocs = async (path: string, isAgents: boolean): Promise<void> => {
  const existing = await readFile(path, "utf8")
  if (isAgents) {
    const separator = "\n\n---\n\n"
    await writeFile(path, `${existing}${separator}${CLI_DOC_CONTENT}`, "utf8")
  } else {
    const cliSection = `

---

## Logbook

${CLI_DOC_CONTENT}
`
    await writeFile(path, `${existing}${cliSection}`, "utf8")
  }
}

const ensureBothDocs = async (cwd: string, force: boolean): Promise<void> => {
  const agentsPath = join(cwd, "AGENTS.md")
  const claudePath = join(cwd, "CLAUDE.md")

  const agentsExists = await fileExists(agentsPath)
  const claudeExists = await fileExists(claudePath)
  const agentsIsSymlink = await isSymlink(agentsPath)
  const claudeIsSymlink = await isSymlink(claudePath)

  if (!force) {
    if (agentsExists && !agentsIsSymlink) {
      console.log("✓ AGENTS.md already exists, appending logbook documentation")
      await appendLogbookDocs(agentsPath, true)
    }
    if (claudeExists && !claudeIsSymlink) {
      console.log("✓ CLAUDE.md already exists, appending logbook documentation")
      await appendLogbookDocs(claudePath, false)
    }
    if (!agentsExists && !claudeExists) {
      await writeFile(agentsPath, CLI_DOC_CONTENT, "utf8")
      console.log("✓ AGENTS.md created")
      await symlink("AGENTS.md", claudePath)
      console.log("✓ CLAUDE.md created (symlink to AGENTS.md)")
    }
    return
  }

  if (agentsExists && !agentsIsSymlink) {
    await appendLogbookDocs(agentsPath, true)
  } else if (!agentsExists) {
    await writeFile(agentsPath, CLI_DOC_CONTENT, "utf8")
    console.log("✓ AGENTS.md created")
  }

  if (claudeExists && !claudeIsSymlink) {
    await appendLogbookDocs(claudePath, false)
  } else if (!claudeExists) {
    const targetExists = await fileExists(agentsPath)
    if (targetExists) {
      await symlink("AGENTS.md", claudePath)
      console.log("✓ CLAUDE.md created (symlink to AGENTS.md)")
    } else {
      await writeFile(
        claudePath,
        `# Logbook

${CLI_DOC_CONTENT}
`,
        "utf8"
      )
      console.log("✓ CLAUDE.md created")
    }
  } else if (claudeIsSymlink) {
    console.log("✓ CLAUDE.md is already a symlink to AGENTS.md, skipping")
  }
}

const printSnippets = (): void => {
  console.log("")
  console.log(CLAUDE_CODE_SNIPPET)
  console.log("")
  console.log(OPENCODE_SNIPPET)
  console.log("")
  console.log(GITIGNORE_SNIPPET)
  console.log("")
  console.log(NEXT_STEPS)
}

export const runInit = async (
  cwd: string = process.cwd(),
  options: { force?: boolean } = {}
): Promise<void> => {
  await scaffoldTasksFile(cwd)
  await scaffoldHooksDir(cwd)
  await ensureBothDocs(cwd, options.force ?? false)
  printSnippets()
}
