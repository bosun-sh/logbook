# Publishing logbook-mcp

This document specifies the packaging path for the Go-based logbook binaries so any
project can use them through npm with zero manual server management.

---

## Why

Claude Code auto-starts MCP servers declared in `.claude/settings.json`. Publishing the
compiled binaries to npm lets any project reference the server as a global command, with
no cloning or local build step.

---

## Changes Required

### 1. `package.json`

- Keep the package name as `@bosun-sh/logbook`
- Expose `logbook` and `logbook-mcp` through small Node launchers in `bin/`
- Build platform binaries into `dist/bin/<platform>/`
- Include `bin/`, `dist/`, `hooks/`, `README.md`, and `LICENSE` in the npm tarball
- Declare a Node engine for the launcher scripts
- Build the binaries in `prepack` so `npm pack` and `npm publish` ship ready-to-run executables

```json
{
  "name": "@bosun-sh/logbook",
  "version": "1.2.0",
  "description": "File-system kanban board CLI and MCP server for AI agents",
  "type": "module",
  "bin": {
    "logbook": "bin/logbook.cjs",
    "logbook-mcp": "bin/logbook-mcp.cjs"
  },
  "files": [
    "bin/",
    "dist/",
    "hooks/",
    "LICENSE",
    "README.md"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "build:binaries": "sh scripts/build-binaries.sh",
    "prepack": "sh scripts/build-binaries.sh",
    "start":          "bun src/mcp/server.ts",
    "test":           "bun test",
    "test:watch":     "bun test --watch",
    "test:unit":      "bun test tests/unit/",
    "test:e2e":       "bun test tests/e2e/",
    "typecheck":      "tsc --noEmit",
    "prepublishOnly": "bun run typecheck"
  },
  "dependencies": {
    "effect": "^3.12.0",
    "zod":    "^3.24.1"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.3"
  }
}
```

---

### 2. `hooks/review-spawn/script.ts` — project-root derivation

**Problem**: the reviewer hook needs to resolve the user's project root, not the package
install location.

**Fix**: derive the project root from `LOGBOOK_TASKS_FILE`, which is always set to the user's
project.

```ts
const projectRoot = path.dirname(process.env.LOGBOOK_TASKS_FILE ?? "./tasks.jsonl")
```

---

### 3. `.claude/settings.json` — use installed binary (dogfooding)

```json
{
  "mcpServers": {
    "logbook": {
      "command": "logbook-mcp",
      "env": {
        "LOGBOOK_TASKS_FILE": "${workspaceFolder}/tasks.jsonl",
        "LOGBOOK_HOOKS_DIR": "${workspaceFolder}/hooks"
      }
    }
  }
}
```

---

## Template for Consuming Projects

Add one of the following to the project's `.claude/settings.json`:

### Option A — global install (recommended for stable setups)

```bash
npm install -g @bosun-sh/logbook
```

```json
{
  "mcpServers": {
    "logbook": {
      "command": "logbook-mcp",
      "env": {
        "LOGBOOK_TASKS_FILE": "${workspaceFolder}/tasks.jsonl",
        "LOGBOOK_HOOKS_DIR": "${workspaceFolder}/hooks"
      }
    }
  }
}
```

### Option B — npx, zero install (recommended for onboarding)

No install step. `npx` caches the package on first run. Pin the version to avoid silent
breaking changes.

```json
{
  "mcpServers": {
    "logbook": {
      "command": "npx",
      "args": ["@bosun-sh/logbook@1.2.0"],
      "env": {
        "LOGBOOK_TASKS_FILE": "${workspaceFolder}/tasks.jsonl",
        "LOGBOOK_HOOKS_DIR": "${workspaceFolder}/hooks"
      }
    }
  }
}
```

---

## Publish Steps

```bash
# 1. Verify types pass
bun run typecheck

# 2. Inspect tarball contents before publishing
npm pack --dry-run
# Expected in tarball: bin/, dist/, hooks/, README.md, LICENSE
# Must NOT appear: tests/, specs/, .claude/, bun.lock, tasks.jsonl, source-only internals

# 3. Test the binary locally before publishing
npm install -g .
# In another project:
npm install -g @bosun-sh/logbook
# Add the settings.json snippet (Option A), open Claude Code, confirm MCP tools appear

# 4. Publish
npm publish
# or: bun publish
```

---

## Verification Checklist

- [ ] `bun run typecheck` exits 0
- [ ] `npm pack --dry-run` tarball contains only `src/`, `hooks/`, `README.md`
- [ ] After `bun link` in a test project, Claude Code connects without manual server start
- [ ] `create_task` and `list_tasks` MCP tools respond correctly
- [ ] Moving a task to `pending_review` triggers `review-spawn` hook and writes the review task to the correct `LOGBOOK_TASKS_FILE` location (not the npm cache)
