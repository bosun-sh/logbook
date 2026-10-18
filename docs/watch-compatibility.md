# Watch compatibility contract

This is the bounded contract for WATCH-S02-T01 (contract v2, SHA-256
`4fec7d993a898b56d5be8108d12b1451e051e819940d8bf5328f8844f32b6c07`).
It characterizes Logbook 2.1.0 at
`eb8d3ba5e2202e140098f9e63ee1e97a7a49cb96` and specifies required successor
behavior for WATCH-S02-T02/T03. The T02 source candidate now implements the bounded
lifecycle and estimate changes below; independent acceptance and a public release
remain separate gates. The T03 source candidate implements mutation identity/recovery;
see [its public behavior and recovery boundaries](watch-operation-identity.md).
No package release or Watch integration is qualified.

Logbook remains canonical for entities, hierarchy, content, context and lifecycle.
Watch's runtime database references Logbook IDs and holds scheduling, blocker,
attempt and policy records; it must not become a second task store. All mutations
go through one Watch-owned Logbook writer. Competing hooks, Linear sync and direct
worker/CLI/MCP writers must remain disabled. The current file lock is an in-process
promise map, not cross-process exclusion (`src/shared/storage/transaction.ts`).

## Reproduce the compatibility checks

```sh
bun install --frozen-lockfile
bun test tests/e2e/cli/watch-compatibility.test.ts
bun test tests/unit/task/lifecycle-transitions-v2.test.ts tests/unit/task/task-estimate-use-case.test.ts tests/unit/task/task-estimation.test.ts tests/unit/story/create-story.test.ts tests/unit/story/story-crud.test.ts tests/e2e/storage/file-repositories.test.ts
bun run ci:lint
```

The lifecycle/estimate (L/E) tests assert the T02 target behavior. Hierarchy (H)
retains its T01 characterization; retry (I) now asserts T03 replay/conflict
behavior. The separate operation-identity suite exercises crash boundaries. The table below preserves the original observations. Each CLI call starts
a fresh process against a disposable real `.logbook/storage` workspace. MCP calls
use the real workspace layer. Tests read canonical JSONL to detect rejected-write
side effects; they never patch task records or touch the operator's board. Public
CLI aliases dispatch the same dotted tools advertised by MCP.

| Case | Observed at the pinned base | Required successor outcome |
| --- | --- | --- |
| L1 | `backlog`, `todo`, `pending_review` → `blocked` return `invalid_transition`, unchanged storage | Block directly with a reason; no fabricated `in_progress` step |
| L2 | Real `in_progress` can block with a regular/need-info comment; missing/oversized comments fail; `blocked` → `todo` fails | Preserve validation and support returning ready work to `todo` |
| L3 | Updating to the same status returns success but drops a supplied comment | Append new attempt/review/blocker evidence without moving lifecycle |
| L4 | MCP rejects empty blocker content; CLI accepts it | Both public paths reject empty new blocker evidence, while reading old records remains compatible |
| E1 | `task.estimate` accepts 64, rejects 65/128; `task.edit` and readers already preserve 128 | The estimate command preserves 65/128 exactly when caller policy permits |
| E2 | Default prediction is zero; command rejects zero/negative/fractional input; Fibonacci is derived from token prediction | Keep command validation, existing defaults/readers and token/effort separation |
| H1 | Creates persist reciprocal epic/story/task links; mismatched epic is rejected; reparenting is not implemented | Preserve successful links and errors; do not pretend an ignored edit repaired hierarchy |
| I1 | CLI ignores `operationId`: same ID creates duplicates and changed payload creates another entity; MCP rejects the field | Same identity and payload replay a durable result; changed payload conflicts without mutation |
| I2 | Retrying a reply with the same ignored identity after process exit appends two distinct replies | One reply and a reconcilable receipt after restart/retry |

The first test run exposed mistaken assumptions that CLI would enforce the
published schemas. Source inspection explains the difference:
`src/workspace/mcp-server.ts` validates `publicToolSchemas` before dispatch;
`src/workspace/cli-adapter.ts` dispatches static tools without that validation.
`src/plugin/tool-registry.ts` registers those handlers without input schemas.
Thus an unrecognized CLI property is not evidence of feature support. Public
compatibility must be tested through both surfaces.

## T02: lifecycle and estimates

The source candidate adds the six required block/resume edges, persists validated
same-status comments without resetting phase/progress fields, and rejects empty
new blocker content through CLI and MCP. Existing stored empty comments remain
readable. The estimate command preserves predictions above 64 while retaining its
finite positive integer and other validation; nested create/edit estimates and
stored defaults keep their broader existing semantics. No storage format changes
or migration are needed. Retry deduplication is supplied by the T03 candidate; no-ID behavior stays unchanged.

The domain transition table is in `src/task/lifecycle.ts`. At the pinned base:

| Source | Allowed destinations (same-status calls are also successful no-ops) |
| --- | --- |
| backlog | todo, canceled |
| todo | in_progress, canceled |
| in_progress | need_info, blocked, pending_review, canceled |
| need_info | in_progress, canceled |
| blocked | in_progress, canceled |
| pending_review | in_progress, done, canceled |
| done / canceled | none |

Minimum extension: add `backlog/todo/pending_review → blocked` and
`blocked → backlog/todo/pending_review`, preserving existing transitions. Watch
saves the source status and affected execution/review phase in its durable blocker
record **before** requesting the transition. On recovery it verifies that record,
the current blocked task and current eligibility/policy before requesting the
corresponding destination. The package validates the transition graph; Watch owns
the authorization to resume that particular phase. This does not authorize
reopening `done`/`canceled`, bypassing review to reach `done`, or inventing execution
history. Already-running blocked work may use the existing return to `in_progress`.
The coordinator must continue using only behavior available in the installed
package until this extension is accepted and released.

Preserve `invalid_transition` with `from`/`to`, `not_found`, and existing storage
errors. Entering `blocked` requires a regular or need-info comment; entering
`need_info` still requires kind `need_info`. New blocker content must be nonempty
and at most 65,536 UTF-8 bytes through CLI and MCP. Existing stored empty comments
remain readable. Rejection must leave status, comments, timestamps, hierarchy and
unrelated entities unchanged. Same-status with no comment stays a no-op; a valid
new comment appends once per distinct operation, preserving phase/progress fields.
Replies continue to target an existing comment; missing comment IDs fail visibly.
T03 supplies retry deduplication; status equality alone is not idempotency.

Remove the estimate command's hard 64-kilotoken ceiling in
`src/task/estimate.ts`; retain its finite, positive integer input rule, allowed
complexity/confidence values and 4,096-byte rationale bound. Caller policy sets
whether a predicted workload is admissible; Logbook must not clamp or divide a
prediction to satisfy the old ceiling. Test exact persistence at 64, 65 and 128,
invalid values, and unchanged unrelated entities. Do not tighten the broader
existing nested estimate schema/readers (`src/shared/schema/value-objects.ts`):
legacy zero defaults and valid stored estimates must remain readable, and existing
`task.create`/`task.edit` callers must retain their validation semantics.

`estimate.fibonacci` is a nearest token bucket in `[1,2,3,5,8,13,21]`, not Scrum
effort; above that range its existing bucket remains 21 while `predictedKTokens`
stays exact. No story-point field exists in these task/story schemas. Watch must
store Scrum estimates separately in its methodology records and never infer them
from Logbook Fibonacci, tokens, subscription percentages or monetary cost. Adding
a Logbook Scrum model is outside this task.

## Hierarchy: preserve and reconcile the public path

Use `epic.create → story.create(epicId) → task.create(storyId)` and the public
get/list tools, not synthetic IDs or direct JSONL edits. Story creation adds its ID
to `epic.storyIds`; task creation inherits the story's epic and adds its ID to
`story.taskIds`. Preserve parent existence/deletion checks, mismatch errors and the
1,000-reference mutation limit (`src/story/hierarchy.ts`, `src/task/hierarchy.ts`).
Standalone task creation is supported; supplying `epicId` without `storyId` does
not currently validate that epic. Do not use that as a hierarchy repair mechanism.

`task.edit` cannot change `storyId`/`epicId`; `story.update` cannot change `epicId`
or child IDs; `epic.update` cannot change child IDs. MCP rejects those unknown
fields, while CLI can silently ignore them. No general reparent/repair API is
required for normal intake. Interrupted intake must preserve entities and report
the inconsistent links; T03 must reconcile its own partially completed creates
through package-owned operations. Never delete/recreate user entities or claim
success from merely finding the child.

## T03: durable mutation identity and acknowledgments

Add an optional nonempty caller `operationId` to the public task mutations Watch
uses: `task.create`, `task.edit`, `task.update` (comments/replies included), and
`task.estimate` when persisting an ID. Existing calls without it retain their
current result shape and semantics. Intake also needs identities for `epic.create`
and `story.create`: retrying their partial parent-link writes must not duplicate
canonical parents/children. This is bounded package behavior, not a generic
command bus or a transaction spanning Watch SQLite and Logbook. Context records
remain canonical in Logbook; extending every other tool is not required here.

The required public contract is:

- Scope identity to a workspace and bind it durably to the tool and validated
  semantic input (excluding `operationId`; JSON object key order is irrelevant).
  A different tool, entity ID or payload reusing the identity is an explicit
  `operation_conflict`, never a new write. Empty/invalid IDs fail before mutation.
- A committed result includes a receipt with `operationId`, tool, affected entity
  IDs, outcome `applied` or `replayed`, and the original logical result. Persist
  the original generated entity/comment/reply IDs and timestamps. A fresh process
  repeating the same request returns that result and receipt without a second
  transition, comment, reply, child or parent-link insertion. Later entity edits
  do not change the historical receipt or cause the old request to run again.
- Expose a read-only public lookup by `operationId`. It distinguishes committed
  result, known incomplete/uncertain operation, and absent identity. An absent
  receipt alone is not proof that no entity write happened in a crash window.
  No definitive success acknowledgment precedes all required canonical writes.
- Record identity/intent before the first effect and reconcile on restart. A crash
  after task/story creation but before parent-link update or receipt commit must
  either finish the same operation safely or report `operation_uncertain` with
  affected IDs and recovery details. Do not blindly create again, silently report
  success, or pretend a multi-file/multi-database transaction exists. A normal
  same-ID retry of an uncertain operation never starts an independent mutation.
- Preserve existing validation/storage errors. Failures before any effect leave
  entities unchanged. Partial writes retain evidence and a reconcilable uncertain
  outcome. A stale/conflicting writer must fail or be fenced by the single-writer
  boundary; the process-local promise map cannot establish cross-process safety.
  A public receipt is not a distributed lock or Watch ownership authority.

The exact storage layout and result types belong to T03, but those observable
outcomes are mandatory. Its acceptance tests must use real public operations and
storage across fresh processes: lost create response; reply/status retry; changed
payload/tool conflict; later mutation followed by old replay; failure before write;
and interrupted child/parent/receipt writes. Injected interruption must stop at
real persistence boundaries, not replace storage with a mock returning success.
An implementation without a durable intent/result journal or equivalent recovery
evidence must not claim exactly-once effects.

Any schema/storage extension needs a consistent backup, reader/version check,
data-preserving upgrade test and restoration procedure before release. Old strict
readers cannot be assumed to accept new fields. Do not run mixed writers during
upgrade, silently strip unknown records, or repair production JSONL by hand.
T04 still requires an immutable compatible public package release and Watch-side
boundary smoke evidence; a source checkout is not that release.

## Additional observations, not new acceptance scope

The domain supports `canceled`, but the advertised public task-status enum omits
it (`src/plugin/public-schemas.ts`). CLI can reach domain behavior that MCP rejects.
This finding does not authorize unrelated cancellation/schema redesign. Likewise,
no general hierarchy repair, cross-process storage framework, Scrum model, release,
user-data migration or Watch implementation is added by T01.
