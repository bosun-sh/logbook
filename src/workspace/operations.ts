import { createHash, randomUUID } from "node:crypto"
import { open, realpath, rename, stat, unlink } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import type { ToolResult } from "@logbook/shared/result.js"
import {
  operationStaging,
  readOptionalFile,
  type StagedFile,
} from "@logbook/shared/storage/operation-staging.js"
import { Context, Effect } from "effect"
import { z } from "zod"
import { resolveWorkspacePaths } from "./storage-layout.js"

const tools = [
  "epic.create",
  "story.create",
  "task.create",
  "task.edit",
  "task.update",
  "task.estimate",
] as const
const fileNames = ["epics.jsonl", "stories.jsonl", "tasks.jsonl"] as const
const operationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0)
const journalSchema = z
  .object({
    version: z.literal(1),
    operationId: operationIdSchema,
    tool: z.enum(tools),
    fingerprint: z.string(),
    state: z.enum(["pending", "committed"]),
    affectedEntityIds: z.array(z.string()),
    result: z.object({ ok: z.literal(true), data: z.record(z.unknown()) }),
    files: z.array(
      z
        .object({ name: z.enum(fileNames), before: z.string().nullable(), after: z.string() })
        .strict()
    ),
  })
  .strict()
type Journal = z.infer<typeof journalSchema>
// A separate instance in the same process may share DuckDB's native lock.
const activeWorkspaces = new Set<string>()
export type OperationCheckpoint = (point: string) => Promise<void>
export const OperationWorkspace = Context.GenericTag<{
  root: string
  checkpoint?: OperationCheckpoint | undefined
}>("OperationWorkspace")

const failure = (
  code: string,
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({ ok: false, error: { code, message, ...(details ? { details } : {}) } })
const receipt = (journal: Journal, outcome: "applied" | "replayed") => ({
  operationId: journal.operationId,
  tool: journal.tool,
  affectedEntityIds: journal.affectedEntityIds,
  outcome,
})
const replay = (journal: Journal, outcome: "applied" | "replayed"): ToolResult<unknown> => ({
  ok: true,
  data: { ...journal.result.data, receipt: receipt(journal, outcome) },
})
const uncertain = (journal: Journal, cause?: unknown): ToolResult<never> =>
  failure(
    "operation_uncertain",
    "Operation is incomplete; retry the identical request through the sole writer.",
    {
      operationId: journal.operationId,
      tool: journal.tool,
      affectedEntityIds: journal.affectedEntityIds,
      recovery:
        "Quiesce other writers, preserve the workspace and retry this operation. If canonical files drifted, restore a consistent backup; do not edit JSONL or delete the journal.",
      ...(cause === undefined ? {} : { cause: String(cause) }),
    }
  )

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

const load = async (db: DuckDBConnection, operationId: string): Promise<Journal | undefined> => {
  const rows = (
    await db.runAndReadAll("SELECT record FROM operations WHERE id = ?", [operationId])
  ).getRowObjects()
  const row = rows[0]
  return row ? journalSchema.parse(JSON.parse(String(row.record))) : undefined
}
const save = (db: DuckDBConnection, journal: Journal) =>
  db.run("INSERT OR REPLACE INTO operations VALUES (?, ?, ?)", [
    journal.operationId,
    journal.state,
    JSON.stringify(journalSchema.parse(journal)),
  ])

const syncDirectory = async (path: string) => {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
const durableWrite = async (path: string, content: string) => {
  const temporary = `${path}.operation-${randomUUID()}`
  try {
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(content, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } finally {
    await unlink(temporary).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause
    })
  }
}

const finish = async (
  db: DuckDBConnection,
  storage: string,
  journal: Journal,
  checkpoint?: OperationCheckpoint
) => {
  // Check the complete write set before resuming; never overwrite an unrelated writer's changes.
  for (const file of journal.files) {
    const current = await readOptionalFile(join(storage, file.name))
    if (current !== file.before && current !== file.after)
      return uncertain(journal, `Canonical drift: ${file.name}`)
  }
  for (const file of journal.files) {
    await durableWrite(join(storage, file.name), file.after)
    await checkpoint?.(`canonical:${file.name}`)
  }
  await save(db, { ...journal, state: "committed", files: [] })
  await syncDirectory(dirname(storage))
  await checkpoint?.("committed")
  return null
}

const withJournal = async (
  root: string,
  lookup: boolean,
  run: (db: DuckDBConnection, storage: string) => Promise<ToolResult<unknown>>
): Promise<ToolResult<unknown>> => {
  const paths = resolveWorkspacePaths(root)
  const path = join(paths.logbookRoot, "operations.duckdb")
  let acquired = false
  let key: string | undefined
  let instance: DuckDBInstance | undefined
  let db: DuckDBConnection | undefined
  try {
    key = await realpath(paths.logbookRoot)
    if (activeWorkspaces.has(key))
      return failure("writer_conflict", "An operation writer is active; retry after it finishes.")
    activeWorkspaces.add(key)
    acquired = true
    if (
      lookup &&
      !(await stat(path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null
        throw cause
      }))
    )
      return { ok: true, data: { state: "absent" } }
    const { DuckDBInstance } = await import("@duckdb/node-api")
    instance = await DuckDBInstance.create(path)
    db = await instance.connect()
    const tables = (
      await db.runAndReadAll(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
      )
    ).getRowObjects()
    if (tables.length === 0 && !lookup) {
      await db.run("BEGIN TRANSACTION")
      await db.run("CREATE TABLE operation_format (version INTEGER NOT NULL)")
      await db.run("INSERT INTO operation_format VALUES (1)")
      await db.run(
        "CREATE TABLE operations (id VARCHAR PRIMARY KEY, state VARCHAR NOT NULL, record VARCHAR NOT NULL)"
      )
      await db.run("COMMIT")
      await syncDirectory(paths.logbookRoot)
    }
    const versions = (
      await db.runAndReadAll("SELECT version FROM operation_format")
    ).getRowObjects()
    if (versions.length !== 1 || versions[0]?.version !== 1)
      return failure(
        "operation_version_unsupported",
        "Unsupported operation journal format; use the matching reader/writer or restore a consistent backup."
      )
    return await run(db, paths.storageRoot)
  } catch (cause) {
    return failure(
      String(cause).includes("Could not set lock") ? "writer_conflict" : "storage_error",
      "Operation journal is unavailable; no new mutation was started.",
      { filePath: path, cause: String(cause) }
    )
  } finally {
    db?.closeSync()
    instance?.closeSync()
    if (key && acquired) activeWorkspaces.delete(key)
  }
}

export const withOperationIdentity = <Input extends Record<string, unknown>, R>(
  tool: (typeof tools)[number],
  input: Input,
  run: (input: Input) => Effect.Effect<ToolResult<unknown>, never, R>
): Effect.Effect<
  ToolResult<unknown>,
  never,
  R | Context.Tag.Identifier<typeof OperationWorkspace>
> => {
  if (input.operationId === undefined) return run(input)
  return Effect.gen(function* () {
    const parsedId = operationIdSchema.safeParse(input.operationId)
    if (!parsedId.success)
      return failure(
        "schema_validation_error",
        "operationId must be a nonblank string of at most 256 characters."
      )
    try {
      publicToolSchemas[tool].parse(input)
    } catch (cause) {
      return failure("schema_validation_error", "Operation input failed schema validation.", {
        cause: String(cause),
      })
    }
    if (tool === "task.estimate" && input.id === undefined)
      return failure("validation_error", "operationId requires a persisted task estimate (id).")
    const workspace = yield* OperationWorkspace
    const context = yield* Effect.context<R>()
    const semantic = { ...input }
    delete semantic.operationId
    const fingerprint = createHash("sha256")
      .update(canonical({ tool, input: semantic }))
      .digest("hex")
    return yield* Effect.promise(() =>
      withJournal(workspace.root, false, async (db, storage) => {
        let journal = await load(db, parsedId.data)
        if (journal && (journal.tool !== tool || journal.fingerprint !== fingerprint))
          return failure(
            "operation_conflict",
            "operationId is already bound to a different tool or input.",
            { operationId: parsedId.data, tool: journal.tool }
          )
        if (journal?.state === "committed") return replay(journal, "replayed")
        const outcome = journal ? "replayed" : "applied"
        try {
          if (!journal) {
            const pending = (
              await db.runAndReadAll("SELECT id FROM operations WHERE state = 'pending' LIMIT 1")
            ).getRowObjects()[0]
            if (pending) {
              const incomplete = await load(db, String(pending.id))
              if (!incomplete) throw new Error("Pending operation disappeared")
              return uncertain(incomplete)
            }
            const files = new Map<string, StagedFile>()
            const result = await operationStaging.run(files, () =>
              Effect.runPromise(Effect.provide(run(semantic), context))
            )
            if (!result.ok) return result
            const serialized = journalSchema.parse({
              version: 1,
              operationId: parsedId.data,
              tool,
              fingerprint,
              state: "pending",
              result,
              affectedEntityIds: [
                ...new Set(
                  [...files.values()].flatMap(({ before, after }) => {
                    const old = new Map(
                      (before ?? "")
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => {
                          const entity = JSON.parse(line)
                          return [entity.id, line]
                        })
                    )
                    return after
                      .split("\n")
                      .filter(Boolean)
                      .flatMap((line) => {
                        const entity = JSON.parse(line)
                        return old.get(entity.id) === line ? [] : [entity.id]
                      })
                  })
                ),
              ],
              files: [...files].map(([path, value]) => ({
                name: relative(resolve(storage), resolve(path)),
                ...value,
              })),
            })
            await workspace.checkpoint?.("before-intent")
            // The committed intent contains generated IDs, timestamps, parent links and the original result.
            journal = serialized
            await save(db, journal)
            await syncDirectory(dirname(storage))
            await workspace.checkpoint?.("intent")
          }
          const problem = await finish(db, storage, journal, workspace.checkpoint)
          return problem ?? replay(journal, outcome)
        } catch (cause) {
          return journal
            ? uncertain(journal, cause)
            : failure("storage_error", "Operation planning failed before canonical writes.", {
                cause: String(cause),
              })
        }
      })
    )
  })
}

export const getOperation = (input: { operationId: string }) =>
  Effect.gen(function* () {
    if (!operationIdSchema.safeParse(input.operationId).success)
      return failure("schema_validation_error", "Invalid operationId.")
    const workspace = yield* OperationWorkspace
    return yield* Effect.promise(() =>
      withJournal(workspace.root, true, async (db) => {
        const journal = await load(db, input.operationId)
        if (!journal) return { ok: true, data: { state: "absent", operationId: input.operationId } }
        if (journal.state === "pending")
          return {
            ok: true,
            data: {
              state: "uncertain",
              ...receipt(journal, "replayed"),
              recovery: uncertain(journal),
            },
          }
        return {
          ok: true,
          data: {
            state: "committed",
            receipt: receipt(journal, "replayed"),
            result: journal.result,
          },
        }
      })
    )
  })
