package logbook

import (
	"fmt"
	"os"
	"path/filepath"
)

const CLI_DOC_CONTENT = "# Logbook CLI\n\n" +
	"File-system kanban board for AI agents.\n\n" +
	"## Commands\n\n" +
	"| Command | Description |\n" +
	"|---------|-------------|\n" +
	"| `logbook create-task` | Create a new task in backlog |\n" +
	"| `logbook list-tasks` | List tasks, optionally filtered by status |\n" +
	"| `logbook current-task` | Get current in-progress task for this session |\n" +
	"| `logbook update-task` | Transition task status |\n" +
	"| `logbook edit-task` | Edit task fields without changing status |\n" +
	"| `logbook init` | Initialize project |\n\n" +
	"## Task Lifecycle\n\n" +
	"`backlog → todo → in_progress → pending_review → done`\n\n" +
	"Side-exits: `in_progress → need_info`, `blocked` (return to `in_progress`)\n\n" +
	"## Usage Examples\n\n" +
	"### Create a task\n" +
	"```bash\n" +
	"logbook create-task --project myproject --milestone v1 --title \"Fix bug\" \\\n" +
	"  --definition-of-done \"Bug fixed and tested\" --description \"Details...\" \\\n" +
	"  --predicted-k-tokens 3\n" +
	"```\n\n" +
	"### List tasks\n" +
	"```bash\n" +
	"logbook list-tasks --status in_progress\n" +
	"logbook list-tasks --status \"*\"\n" +
	"logbook list-tasks --status todo --project myproject\n" +
	"```\n\n" +
	"### Get current task\n" +
	"```bash\n" +
	"logbook current-task\n" +
	"```\n\n" +
	"### Update task status\n" +
	"```bash\n" +
	"logbook update-task --id <uuid> --new-status in_progress\n" +
	"logbook update-task --id <uuid> --new-status need_info \\\n" +
	"  --comment-title \"Need info\" --comment-content \"What does X mean?\"\n" +
	"```\n\n" +
	"### Edit task\n" +
	"```bash\n" +
	"logbook edit-task --id <uuid> --title \"New title\"\n" +
	"```\n\n" +
	"## Environment Variables\n\n" +
	"| Variable | Default | Description |\n" +
	"|----------|---------|-------------|\n" +
	"| `LOGBOOK_TASKS_FILE` | `./tasks.jsonl` | Path to JSONL task store |\n" +
	"| `LOGBOOK_HOOKS_DIR` | `./hooks` | Directory for hook definitions |\n" +
	"| `LOGBOOK_SESSION_ID` | auto-generated | Session ID to use |\n"

const CLAUDE_CODE_SNIPPET = "Claude Code — add to .claude/settings.json:\n" +
	"{\n" +
	"  \"mcpServers\": {\n" +
	"    \"logbook\": {\n" +
	"      \"command\": \"logbook-mcp\"\n" +
	"    }\n" +
	"  }\n" +
	"}"

const OPENCODE_SNIPPET = "OpenCode — add to opencode.json:\n" +
	"{\n" +
	"  \"mcp\": {\n" +
	"    \"logbook\": {\n" +
	"      \"type\": \"local\",\n" +
	"      \"command\": [\"logbook-mcp\"],\n" +
	"      \"enabled\": true\n" +
	"    }\n" +
	"  }\n" +
	"}"

const GITIGNORE_SNIPPET = ".gitignore — add these runtime files:\n" +
	"tasks.jsonl\n" +
	"sessions.json\n" +
	".logbook-session"

const NEXT_STEPS = "Next steps:\n" +
	"  1. Add the config snippet for your AI client (MCP) or use CLI directly\n" +
	"  2. Run: LOGBOOK_TASKS_FILE=./tasks.jsonl logbook init\n" +
	"  3. See AGENTS.md for CLI commands reference\n" +
	"  4. See quickstart.md for the full walkthrough"

func RunInit(cwd string, force bool) error {
	if err := scaffoldTasksFile(cwd); err != nil {
		return err
	}
	if err := scaffoldHooksDir(cwd); err != nil {
		return err
	}
	if err := ensureBothDocs(cwd, force); err != nil {
		return err
	}
	printSnippets()
	return nil
}

func scaffoldTasksFile(cwd string) error {
	path := filepath.Join(cwd, "tasks.jsonl")
	if _, err := os.Stat(path); err == nil {
		fmt.Println("✓ tasks.jsonl already exists, skipping")
		return nil
	}
	if err := os.WriteFile(path, []byte{}, 0o644); err != nil {
		return err
	}
	fmt.Println("✓ tasks.jsonl created")
	return nil
}

func scaffoldHooksDir(cwd string) error {
	path := filepath.Join(cwd, "hooks")
	if _, err := os.Stat(path); err == nil {
		fmt.Println("✓ hooks/ already exists, skipping")
		return nil
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		return err
	}
	fmt.Println("✓ hooks/ created")
	return nil
}

func appendLogbookDocs(path string, isAgents bool) error {
	existing, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if isAgents {
		return os.WriteFile(path, append(append(existing, []byte("\n\n---\n\n")...), []byte(CLI_DOC_CONTENT)...), 0o644)
	}
	cliSection := "\n\n---\n\n## Logbook\n\n" + CLI_DOC_CONTENT + "\n"
	return os.WriteFile(path, append(existing, []byte(cliSection)...), 0o644)
}

func ensureBothDocs(cwd string, force bool) error {
	agentsPath := filepath.Join(cwd, "AGENTS.md")
	claudePath := filepath.Join(cwd, "CLAUDE.md")
	agentsExists := fileExists(agentsPath)
	claudeExists := fileExists(claudePath)
	agentsSymlink := isSymlink(agentsPath)
	claudeSymlink := isSymlink(claudePath)
	if !force {
		if agentsExists && !agentsSymlink {
			fmt.Println("✓ AGENTS.md already exists, appending logbook documentation")
			if err := appendLogbookDocs(agentsPath, true); err != nil {
				return err
			}
		}
		if claudeExists && !claudeSymlink {
			fmt.Println("✓ CLAUDE.md already exists, appending logbook documentation")
			if err := appendLogbookDocs(claudePath, false); err != nil {
				return err
			}
		}
		if !agentsExists && !claudeExists {
			if err := os.WriteFile(agentsPath, []byte(CLI_DOC_CONTENT), 0o644); err != nil {
				return err
			}
			fmt.Println("✓ AGENTS.md created")
			if err := os.Symlink("AGENTS.md", claudePath); err != nil {
				return err
			}
			fmt.Println("✓ CLAUDE.md created (symlink to AGENTS.md)")
		}
		return nil
	}
	if agentsExists && !agentsSymlink {
		if err := appendLogbookDocs(agentsPath, true); err != nil {
			return err
		}
	} else if !agentsExists {
		if err := os.WriteFile(agentsPath, []byte(CLI_DOC_CONTENT), 0o644); err != nil {
			return err
		}
		fmt.Println("✓ AGENTS.md created")
	}
	if claudeExists && !claudeSymlink {
		if err := appendLogbookDocs(claudePath, false); err != nil {
			return err
		}
	} else if !claudeExists {
		if fileExists(agentsPath) {
			if err := os.Symlink("AGENTS.md", claudePath); err != nil {
				return err
			}
			fmt.Println("✓ CLAUDE.md created (symlink to AGENTS.md)")
		} else {
			if err := os.WriteFile(claudePath, []byte("# Logbook\n\n"+CLI_DOC_CONTENT+"\n"), 0o644); err != nil {
				return err
			}
			fmt.Println("✓ CLAUDE.md created")
		}
	}
	return nil
}

func printSnippets() {
	fmt.Println()
	fmt.Println(CLAUDE_CODE_SNIPPET)
	fmt.Println()
	fmt.Println(OPENCODE_SNIPPET)
	fmt.Println()
	fmt.Println(GITIGNORE_SNIPPET)
	fmt.Println()
	fmt.Println(NEXT_STEPS)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isSymlink(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink != 0
}
