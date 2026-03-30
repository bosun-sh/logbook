# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] — 2026-03-30

### Fixed

- Propagate domain errors with correct error codes (-32001 to -32006) instead of generic -32603
- Reply cycle in `update_task` now accessible via MCP interface (optional `id` and `reply` fields)
- Fixed MCP configuration issues

### Added

- OpenCode integration (`opencode.json`)
- Improved review flow with better error handling
- New tests for error codes and reply cycle

---

## [0.2.0] — 2026-03-29 — Initial public release

### Added

- **MCP server** (`logbook-mcp`) with five tools: `list_tasks`, `current_task`, `update_task`, `create_task`, `edit_task`
- **Task lifecycle** with seven statuses: `backlog → todo → in_progress → pending_review → done` (plus `need_info` and `blocked` side-channels)
- **Hooks system** — declarative `config.yml` + script pairs that fire on `task.status_changed` events; supports any executable language
- **Built-in hooks**:
  - `need-info-notify` — notifies the user when a task moves to `need_info` with the blocking comment
  - `review-spawn` — spawns a reviewer sub-agent and creates a `review-*` task when a task moves to `pending_review`
  - Second-task guard — requires a justification comment before a second task can enter `in_progress`
- **JSONL persistence** — one task per line, append-only writes; human-readable without tooling
- **Session-scoped agents** — each MCP connection is a distinct agent; `current_task` is scoped to the calling session
- **Effect.ts** typed error handling throughout; Zod validation at every MCP boundary
- 100% test coverage (unit + E2E)

### Package

- Published as `logbook-mcp` on npm
- Requires Bun ≥ 1.0.0
- Two production dependencies: `effect`, `zod`
