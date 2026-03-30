# Publishing logbook-mcp

This document specifies all changes required to publish logbook as an npm package so any project can use it with zero manual server management.

---

## Why

Claude Code auto-starts MCP servers declared in `.claude/settings.json`. Currently the config uses `bun src/mcp/server.ts`, which only works inside the logbook repo. Publishing to npm lets any project reference the server as a global command — no cloning, no path management.

---

## Changes Required

### 1. `package.json`

- Remove `"private": true`
- Rename `"name"` from `"logbook"` to `"logbook-mcp"`
- Bump `"version"` to `"0.2.0"`
- Add `"bin"` — the shebang is already in `src/mcp/server.ts`
- Add `"files"` whitelist — include source, exclude tests/specs/.claude/lock files
- Add `"engines"` — declares Bun as a hard requirement (already used via `Bun.spawn`)
- Add `"publishConfig"` — prevents accidental publish to a private registry
- Add `"prepublishOnly"` script — runs typecheck before every publish as a quality gate

```json
{
  "name": "@bosun-sh/logbook-mcp",
  "version": "0.2.0",
  "description": "File-system kanban board MCP server for AI agents",
  "type": "module",
  "bin": {
    "logbook-mcp": "src/mcp/server.ts"
  },
  "files": [
    "src/",
    "hooks/",
    "README.md"
  ],
  "engines": {
    "bun": ">=1.0.0"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
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

### 2. `hooks/review-spawn/script.ts` — fix path derivation (line 88)

**Problem**: line 88 derives the project root from `import.meta.url`. When the package is installed globally, `import.meta.url` resolves to the npm cache (e.g. `~/.bun/install/global/node_modules/logbook-mcp/`), not the user's project. The `--mcp-config` path passed to the reviewer agent ends up pointing at the wrong directory.

**Fix**: derive the project root from `LOGBOOK_TASKS_FILE` instead, which is always set to the user's project.

```ts
// Before (line 88):
const projectRoot = path.dirname(path.dirname(path.dirname(import.meta.url.replace("file://", ""))))

// After:
const projectRoot = path.dirname(process.env['LOGBOOK_TASKS_FILE'] ?? './tasks.jsonl')
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
bun install -g @bosun-sh/logbook-mcp
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

### Option B — bunx, zero install (recommended for onboarding)

No install step. `bunx` caches the package on first run. Pin the version to avoid silent breaking changes.

```json
{
  "mcpServers": {
    "logbook": {
      "command": "bunx",
      "args": ["@bosun-sh/logbook-mcp@0.2.0"],
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
# Expected in tarball: src/, hooks/, README.md
# Must NOT appear: tests/, specs/, .claude/, bun.lock, tasks.jsonl

# 3. Test the binary locally before publishing
bun link
# In another project:
bun link @bosun-sh/logbook-mcp
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
