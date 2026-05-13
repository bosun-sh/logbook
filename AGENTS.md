# Logbook V2 — Ship State

`@bosun-sh/logbook` v2.0.0 is complete and shipped. See `CHANGELOG.md` for breaking changes
and `README.md` for the full v2 surface. The v2 Ohtools-based surface is the single source of truth.

## Architecture Contract

Production TypeScript code must use the v2 screaming architecture roots:

```text
src/epic/*
src/story/*
src/task/*
src/context/*
src/sync/*
src/plugin/*
src/hook/*
src/workspace/*
src/shared/*
src/index.ts
```

Entity behavior belongs under its entity directory. Use `src/shared/*` only for
true cross-entity primitives, repository mechanics, schema helpers, runtime
tags, result envelopes, IDs, time, pagination, and error contracts.

The implementation must preserve these principles from the spec:

- Functional core, imperative shell.
- File-native canonical storage; DuckDB is optional and non-canonical.
- Static Ohtools registry with thin CLI and MCP adapters.
- Public schemas are object-rooted, machine-readable, and reject unknown fields
  unless the compatibility spec explicitly says otherwise.
- V1 compatibility exists only where the v2 spec explicitly retains it.
- Every unbounded operation must have an explicit bound, default, and failure or
  continuation behavior.
- Linear is the required real sync provider for v2.
- GitHub sync is deferred and must not be implemented for v2.

## Local Commands

Use the smallest relevant check first, then broader checks as needed:

```bash
bun test
bun test tests/unit/
bun test tests/e2e/
bun run typecheck
bun run check
bun run build:binaries
```
