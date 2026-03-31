import { access, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Config snippet constants (pure — no side effects)
// ---------------------------------------------------------------------------

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
sessions.json`

const NEXT_STEPS = `Next steps:
  1. Add the config snippet for your AI client
  2. Run: LOGBOOK_TASKS_FILE=./tasks.jsonl logbook-mcp
  3. In your AI client, call current_task() to verify — expected: no_current_task
  4. See quickstart.md for the full walkthrough`

// ---------------------------------------------------------------------------
// Side-effecting helpers (file I/O at boundary)
// ---------------------------------------------------------------------------

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const runInit = async (cwd: string = process.cwd()): Promise<void> => {
  await scaffoldTasksFile(cwd)
  await scaffoldHooksDir(cwd)
  printSnippets()
}
