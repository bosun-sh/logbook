---
id: domain/types
layer: domain
status: ready
depends_on: []
test_file: none
source_file: src/domain/types.ts
module_path: "@logbook/domain/types"
priority: 1
---

# Domain Types

## Purpose
Defines all Zod schemas and the `TaskError` discriminated union — the single source of truth for every type in the system.

## Signature
```ts
import { z } from "zod"

export const StatusSchema = z.enum([
  'backlog', 'todo', 'need_info', 'blocked',
  'in_progress', 'pending_review', 'done',
])
export type Status = z.infer<typeof StatusSchema>

export const CommentKindSchema = z.enum(['need_info', 'regular'])
export type CommentKind = z.infer<typeof CommentKindSchema>

export const CommentSchema = z.object({
  id:        z.string().min(1),
  timestamp: z.coerce.date(),
  title:     z.string().min(1),
  content:   z.string(),           // intentionally allows empty
  reply:     z.string(),           // intentionally allows empty
  kind:      CommentKindSchema,
})
export type Comment = z.infer<typeof CommentSchema>

export const AgentSchema = z.object({
  id:          z.string().min(1),
  title:       z.string().min(1),
  description: z.string(),
})
export type Agent = z.infer<typeof AgentSchema>

export const TaskSchema = z.object({
  project:            z.string().min(1),
  milestone:          z.string().min(1),
  id:                 z.string().min(1),
  title:              z.string().min(1),
  definition_of_done: z.string().min(1),
  description:        z.string().min(1),
  estimation:         z.number().int().positive(),
  comments:           z.array(CommentSchema),
  assignee:           AgentSchema,
  status:             StatusSchema,
  in_progress_since:  z.coerce.date().optional(),
})
export type Task = z.infer<typeof TaskSchema>

export type TaskError =
  | { readonly _tag: 'not_found';             readonly taskId: string }
  | { readonly _tag: 'transition_not_allowed'; readonly from: Status; readonly to: Status }
  | { readonly _tag: 'validation_error';       readonly message: string }
  | { readonly _tag: 'missing_comment' }
  | { readonly _tag: 'conflict';               readonly taskId: string }
  | { readonly _tag: 'no_current_task' }
```

## Contract

### Types

| Name | Schema | Notes |
|------|--------|-------|
| `Status` | enum of 7 values | see status-machine for valid transitions |
| `CommentKind` | `'need_info' \| 'regular'` | drives reply cycle logic |
| `Comment` | object | `content` and `reply` allow empty strings |
| `Agent` | object | `id` is the session_id assigned at connect |
| `Task` | object | `in_progress_since` optional — set only when status is `in_progress` |
| `TaskError` | discriminated union on `_tag` | 6 variants |

### TaskError Variants

| `_tag` | Extra fields | Meaning |
|--------|-------------|---------|
| `not_found` | `taskId: string` | No task with that id |
| `transition_not_allowed` | `from: Status, to: Status` | Illegal state transition |
| `validation_error` | `message: string` | Schema or business rule violated |
| `missing_comment` | — | Required comment absent |
| `conflict` | `taskId: string` | Duplicate id on save |
| `no_current_task` | — | Session has no in_progress task |

### Invariants
- `TaskError` must never be extended without adding a new `_tag` variant.
- `Comment.content` and `Comment.reply` intentionally allow empty strings at the schema level; domain rules enforce non-emptiness where required.
- `Task.estimation` is `int().positive()` — Fibonacci validation is a separate domain rule in `fibonacci.ts`, not enforced by the schema.
- `Task.in_progress_since` is only meaningful when `status === 'in_progress'`.

## Implementation Notes
- This file is pure type and schema definitions — no Effect.ts, no executable logic.
- All other modules import from this file; it has no imports from `@logbook/`.
- `z.coerce.date()` handles JSONL round-trip (dates stored as ISO strings).
- Do NOT add extra fields to schemas without updating all serialisation/deserialisation code.

## Implementation Checklist
- [ ] Create `src/domain/types.ts`
- [ ] Define all Zod schemas: `StatusSchema`, `CommentKindSchema`, `CommentSchema`, `AgentSchema`, `TaskSchema`
- [ ] Export inferred types: `Status`, `CommentKind`, `Comment`, `Agent`, `Task`
- [ ] Define `TaskError` discriminated union with all 6 variants
- [ ] Verify `z.coerce.date()` handles ISO string round-trip

## Dependencies
- `zod` — validation and type inference
