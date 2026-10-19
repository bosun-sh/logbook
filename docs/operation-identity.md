# Durable mutation identities

CLI and MCP clients can safely retry supported mutations after losing a response.
Canonical entities remain in the existing JSONL files.

## Public calls

The CLI and MCP registry accept optional `operationId` on `epic.create`,
`story.create`, `task.create`, `task.edit`, `task.update` (including comments and
replies), and `task.estimate` with an entity `id`. IDs are workspace-scoped,
nonblank strings of at most 256 characters. Identified calls validate the public
schema on both surfaces before planning. A pure estimate without an entity ID
cannot carry an operation identity. Calls without an identity retain their result
shape and existing domain behavior.

For example, send this JSON to `logbook task:create` (MCP: `task.create`):

```json
{"title":"Durable task","description":"Fixture","definitionOfDone":"Verified","project":"example","milestone":"release","operationId":"intake:task:42"}
```

Success preserves the original `data.task` (or other original result) and adds
`data.receipt`:

```json
{"operationId":"intake:task:42","tool":"task.create","affectedEntityIds":["task-generated"],"outcome":"applied"}
```

A retry returns the original generated IDs, timestamps and result with outcome
`replayed`, even after a later edit to the entity. The validated request is bound
to the tool and input excluding `operationId`; JSON object key order is irrelevant.
Different payloads, tools or entity IDs return `operation_conflict`. Defaults are
not expanded for fingerprinting: repeat the same request. Rejected validation or
planning binds no identity and makes no canonical writes.

The identity wrapper removes `operationId` before invoking domain handlers. An
identified `task.edit` with only `id` keeps canonical task bytes and timestamps
unchanged and records a receipt with no affected entity IDs. Its original result
remains replayable after later edits, just like a mutation with canonical writes.

`logbook operation:get --operation-id intake:task:42` (MCP: `operation.get`) returns:

- `data.state: "committed"`, `data.receipt`, and the original `{ok,data}` in
  `data.result`;
- `data.state: "uncertain"`, operation/tool/affected IDs and recovery details for
  an intent whose full completion has not been acknowledged;
- `data.state: "absent"` when no record exists.

Lookup never applies pending canonical writes or triggers automatic Linear pull.
Opening the journal may perform DuckDB's internal WAL recovery/checkpointing; it
is a read-only **application** operation, not a promise of zero filesystem I/O.
Absent alone cannot establish that an arbitrary legacy/external write never
happened, nor prove the caller's other database committed. Busy, corrupt,
unsupported-format or inaccessible journals are explicit errors, never `absent`.

## Persistence and recovery boundaries

All six registry handlers still run the existing validation, domain and hierarchy
logic. Only identified requests stage JSONL repository writes in memory. The
complete validated write set, before/after file images, generated result and IDs
are committed to `.logbook/operations.duckdb` **before** the first canonical write.
The existing pinned `@duckdb/node-api` dependency supplies the journal's local
transaction/WAL and native exclusive writer lock. A process-local guard also
rejects overlapping instances in one process. The native lock releases on exit or
SIGKILL; recovery never steals a PID/mkdir lock.

Each canonical file is written to an exclusive temporary file, file-synced,
renamed and directory-synced. After every required file is complete, the journal
commits the receipt and drops pending file images. Journal parent-directory sync
also covers creation of its database/WAL entries. There is no acknowledgment of
success before those boundaries. DuckDB's filesystem durability and the host's
fsync implementation remain assumptions; process-kill tests do not qualify
physical power loss, filesystem corruption or network filesystems.

A pending retry compares **all** affected canonical files to the journal's exact
before/after images, then finishes that same write set. It never regenerates the
child, comment, reply or parent link. `operation_uncertain` reports storage failure
or drift with affected IDs and recovery instructions. While pending, a different
new identified request is blocked; a previously committed request can replay its
historical result. Read-only lookup leaves partial files intact. On storage
failure, restore access then retry the original request. On unexplained drift,
quiesce writers and preserve evidence; restore a consistent backup or obtain an
explicit package-owned recovery change, never delete the receipt/recreate the
entity or hand-edit JSONL. A process killed during temporary-file output may leave
an unused `.operation-*` file; it is not a canonical record or a receipt.

The journal lock fences **identified calls using this package**, not old versions,
unidentified calls, arbitrary file editors, or external services. Callers must
coordinate a single owning writer and disable hooks, automatic Linear sync and
independent clients that could write outside this mechanism. Do not mix these
writers. Public readers may observe partial
hierarchy between canonical files; consult the operation acknowledgment before
advancing a client's separate durable state. No atomic multi-file visibility or
transaction spanning a client store and Logbook is claimed.

This is a bounded intent/receipt journal, not a second task store. Pending work
uses whole-file snapshots, consistent with the existing repository's whole-file
rewrite model; completed receipts retain historical results indefinitely. No
pruning, arbitrary tool dispatch, reparent API, migration service or concurrency
framework is provided.

## Upgrade, backup and restore

Entity schemas and canonical paths are unchanged. Legacy no-ID workspaces need
no conversion; the journal initializes on the first identified call. The journal
has a workspace format version (`operation_format.version = 1`) and strict
versioned records; mismatches fail closed. Old readers can still read unchanged
entity JSONL, but **old writers do not participate in operation identity** and
must remain stopped. Do not downgrade into a live journal workflow.

Before upgrading, stop every writer and wait for active calls to finish. Preserve
pending operations and copy the **entire `.logbook` directory**, including
`operations.duckdb` and any `operations.duckdb.wal`, as one quiescent backup. Pin
the matching package and native dependency/platform. Validate public lookup and a
disposable retry before resuming the sole writer. On restoration, stop all writers
again, preserve the failed directory separately, and restore the entire consistent
backup with its matching package; never combine individual JSONL and journal files
from different points in time. Do not delete an existing journal to force an
upgrade. Clients must reconcile their own state against public receipts separately.

Executable tests in `tests/e2e/cli/operation-identity.test.ts` exercise legacy data,
consistent backup/restore and unsupported journal versions. No operator data was
migrated. Keep the package version pinned with backups; source tests do not qualify
an installed release on every supported platform.

## Verification

```sh
bun test tests/e2e/cli/operation-identity.test.ts
bun run ci:premerge
```

The process fixture calls real CLI/MCP registry operations and real storage. Its
injected checkpoints occur before intent, after durable intent, after each real
canonical file write and after receipt commit. SIGKILL exits before response;
fresh processes inspect and retry. Tests also cover concurrent native-lock
rejection/release, canonical permission failures, unrelated drift, malformed
storage errors, invalid identities, payload/tool conflicts and old-result replay.
