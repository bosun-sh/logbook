# Logbook Specs

Atomic, AI-first specifications for the logbook MVP. Each file is independently implementable given its `depends_on` chain.

## Reading Order (topological by `depends_on`)

### Wave 1 — no deps
1. [domain/types](domain/types.md) — Zod schemas + TaskError union
2. [domain/fibonacci](domain/fibonacci.md) — validateFibonacci
3. [domain/status-machine](domain/status-machine.md) — guardTransition
4. [task/ports](task/ports.md) — TaskRepository port
5. [hook/ports](hook/ports.md) — HookRunner + HookEvent

### Wave 1b — depends on Wave 1 (test infrastructure)
6. [infra/in-memory-task-repository](infra/in-memory-task-repository.md)

### Wave 2 — depends on Wave 1
7. [task/create-task](task/create-task.md)
8. [task/list-tasks](task/list-tasks.md)
9. [task/current-task](task/current-task.md)
10. [task/edit-task](task/edit-task.md)
11. [hook/hook-executor](hook/hook-executor.md)
12. [infra/jsonl-task-repository](infra/jsonl-task-repository.md)
13. [mcp/error-codes](mcp/error-codes.md) — pure mapping, depends only on `domain/types`

### Wave 3 — depends on Wave 2
14. [task/update-task](task/update-task.md)
15. [hook/default-need-info](hook/default-need-info.md)
16. [hook/default-concurrent-guard](hook/default-concurrent-guard.md)
17. [infra/hook-config-loader](infra/hook-config-loader.md)

### Wave 4 — depends on Wave 3
18. [hook/default-review-spawn](hook/default-review-spawn.md)
19. [mcp/session](mcp/session.md)
20. [mcp/tool-list-tasks](mcp/tool-list-tasks.md)
21. [mcp/tool-current-task](mcp/tool-current-task.md)
22. [mcp/tool-update-task](mcp/tool-update-task.md)
23. [mcp/tool-create-task](mcp/tool-create-task.md)
24. [mcp/tool-edit-task](mcp/tool-edit-task.md)

### Wave 5 — integration
25. [mcp/server](mcp/server.md)
26. [flows/need-info-flow](flows/need-info-flow.md)
27. [flows/review-flow](flows/review-flow.md)
28. [flows/review-agent-config](flows/review-agent-config.md)

## Layer Graph

```
domain/types
    ├── domain/fibonacci
    ├── domain/status-machine
    ├── mcp/error-codes
    ├── task/ports
    │       ├── infra/in-memory-task-repository (test helper)
    │       ├── task/create-task
    │       ├── task/list-tasks
    │       ├── task/current-task
    │       ├── task/edit-task
    │       ├── task/update-task ──── hook/ports + domain/status-machine
    │       └── infra/jsonl-task-repository
    └── hook/ports
            ├── hook/hook-executor
            ├── hook/default-need-info
            ├── hook/default-concurrent-guard
            ├── hook/default-review-spawn
            └── infra/hook-config-loader
mcp/session
    └── mcp/server ──── all task/* + hook/* + infra/*
flows/* ──── mcp/server
```

## Module Path Convention

Each spec's `module_path` maps to a source file:

```
@logbook/<path>  →  src/<path>.ts
```

Examples:
- `@logbook/domain/types` → `src/domain/types.ts`
- `@logbook/task/ports` → `src/task/ports.ts`
- `@logbook/infra/jsonl-task-repository` → `src/infra/jsonl-task-repository.ts`

Hook scripts use `source_file` directly (e.g. `hooks/need-info-notify/script.ts`) and have `module_path: n/a`.
Flow specs are documentation-only and have `source_file: n/a`.

## Status Legend
- `draft` — written, not reviewed
- `ready` — reviewed, ready to implement
- `implemented` — linked test file passes
