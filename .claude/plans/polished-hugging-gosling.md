# Plan: 100% Line Coverage for MVP v1

## Context

The previous plan brought coverage to 98.79% lines / 94.19% funcs (173 unit tests + 17 e2e tests, all passing). Two source files still have uncovered branches, all of which are defensive error paths. The goal is 100% line coverage for the v1 release.

---

## Uncovered Lines Analysis

### `src/hook/hook-executor.ts`

**Line 21** — `catch {}` in `evaluateCondition`:
```ts
const evaluateCondition = (condition: string, event: HookEvent): boolean => {
  try {
    const fn = new Function("new_status", "old_status", "task_id", "session_id", `return (${condition})`)
    return Boolean(fn(...))
  } catch {      // <-- line 21
    return false
  }
}
```
Triggered by passing a syntactically invalid condition string (e.g. `"new_status == "`).

**Lines 49-50** — `.catch()` on `child.exited`:
```ts
child.exited.then(() => {
  clearTimeout(timer); resolve()
}).catch(() => {          // <-- line 49
  clearTimeout(timer); resolve()  // <-- line 50
})
```
`child.exited` is a `Promise<number>` in Bun — it never rejects in practice. This branch is **unreachable** dead code. The fix is to replace the `.then().catch()` chain with `await child.exited` inside the existing async context (wrapping the inner body in an async IIFE), which eliminates the branch entirely and keeps identical behaviour.

---

### `src/infra/jsonl-task-repository.ts`

Lines 18-19, 43-44, 75-76, 97-98 are the same pattern repeated in `save()`, `update()`, `findById()`, and `findByStatus()`:
```ts
const content = await readFile(this.filePath, "utf8").catch((e: unknown) => {
  if (isEnoent(e)) return ""   // <-- uncovered
  throw e
})
```
Triggered by constructing `JsonlTaskRepository` with a path to a file that does not yet exist, then calling the method. All existing tests use `createTempJsonl()` which pre-creates the file — so this path is never hit.

---

## Implementation Plan

### Step 1 — Eliminate dead branch in `hook-executor.ts`

**File:** `src/hook/hook-executor.ts` lines ~44-52

Replace the `.then().catch()` Promise chain with an async IIFE so there is only one code path:

```ts
// Before
child.exited.then(() => {
  clearTimeout(timer)
  resolve()
}).catch(() => {
  clearTimeout(timer)
  resolve()
})

// After
void (async () => {
  try { await child.exited } finally {
    clearTimeout(timer)
    resolve()
  }
})()
```

This is a pure refactor: identical runtime behaviour, but the `.catch()` dead branch disappears and `finally` covers both success and error with one block.

### Step 2 — Add tests for `evaluateCondition` invalid-syntax catch

**File:** `tests/unit/hook/hook-executor.test.ts` (add to existing file)

Add one test case: pass a `HookConfig` with `condition: "new_status == "` (unclosed string literal). The hook should not execute (condition evaluates to `false` via the catch), same as a non-matching condition.

Pattern: same as existing condition-mismatch test in that file.

### Step 3 — Add ENOENT tests for `JsonlTaskRepository`

**File:** `tests/e2e/jsonl-repository.test.ts` (add to existing file)

Add 4 test cases — one per method — where `JsonlTaskRepository` is constructed with a path to a **non-existent file** (use `tmp.path` without calling `writeFile` to seed it):

| Test | Method | Expected result |
|------|--------|----------------|
| `save() on missing file` | `save(task)` | succeeds; file is created; `findById` returns task |
| `update() on missing file` | `update(task)` | succeeds silently (task not written, but no error thrown) |
| `findById() on missing file` | `findById("x")` | fails with `not_found` |
| `findByStatus() on missing file` | `findByStatus("backlog")` | returns `[]` |

Pattern: reuse `createTempJsonl()` helper but **skip the seed write** — get the path from `tmp.path`, clean up with `tmp.cleanup()`.

---

## Critical Files

| File | Action |
|------|--------|
| `src/hook/hook-executor.ts` | Refactor lines 44-52: replace `.then().catch()` with async IIFE + `finally` |
| `tests/unit/hook/hook-executor.test.ts` | Add 1 test: invalid condition string triggers catch → hook skipped |
| `tests/e2e/jsonl-repository.test.ts` | Add 4 tests: each repository method called on a non-existent file |

---

## Verification

1. `bun run typecheck` → exits 0
2. `bun test --coverage` → 100% lines, 100% funcs across all `src/` files
3. All existing tests continue to pass (0 regressions)
