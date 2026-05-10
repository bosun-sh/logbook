import type { ToolResult } from "@logbook/shared/result.js"
import { type Clock, Effect } from "effect"
import { resolveWorkspacePaths } from "./storage-layout.js"

const DEFAULT_MAX_INPUT_LINES = 1_000_000
const DEFAULT_QUERY_LIMIT = 1_000
const DEFAULT_REBUILD_TIMEOUT_MS = 60_000
const DUCKDB_IMPLEMENTATION = "duckdb_in_memory"
const DISABLED_IMPLEMENTATION = "disabled"

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]

export type DuckDbIndexOptions = {
  readonly workspaceRoot: string
  readonly enabled?: boolean | undefined
  readonly indexPath?: string | undefined
  readonly maxInputLines?: number | undefined
  readonly queryLimit?: number | undefined
  readonly rebuildTimeoutMs?: number | undefined
}

export type DuckDbIndexQueryInput = {
  readonly id?: string | undefined
  readonly kind?: string | undefined
  readonly text?: string | undefined
  readonly includeDeleted?: boolean | undefined
  readonly limit?: number | undefined
}

export type IndexedRecord = {
  readonly id: string
  readonly kind: string
  readonly filePath: string
  readonly line: number
  readonly updatedAt?: string | undefined
  readonly deletedAt?: string | undefined
  readonly record: Record<string, unknown>
}

export type DuckDbIndexQueryResult = {
  readonly items: readonly IndexedRecord[]
  readonly hasMore: boolean
}

export type DuckDbIndexRebuildResult = {
  readonly enabled: boolean
  readonly implementation: typeof DUCKDB_IMPLEMENTATION | typeof DISABLED_IMPLEMENTATION
  readonly rebuiltAt?: string | undefined
  readonly filesScanned: number
  readonly linesScanned: number
  readonly recordsIndexed: number
  readonly indexPath: string
}

type IndexFailure = Extract<ToolResult<never>, { ok: false }>

export class DuckDbIndex {
  private readonly workspaceRoot: string
  private readonly enabled: boolean
  private readonly indexPath: string
  private readonly maxInputLines: number
  private readonly queryLimit: number
  private readonly rebuildTimeoutMs: number

  constructor(options: DuckDbIndexOptions) {
    const layout = resolveWorkspacePaths(options.workspaceRoot)
    this.workspaceRoot = options.workspaceRoot
    this.enabled = options.enabled ?? true
    this.indexPath = options.indexPath ?? layout.logbookRoot
    this.maxInputLines = options.maxInputLines ?? DEFAULT_MAX_INPUT_LINES
    this.queryLimit = options.queryLimit ?? DEFAULT_QUERY_LIMIT
    this.rebuildTimeoutMs = options.rebuildTimeoutMs ?? DEFAULT_REBUILD_TIMEOUT_MS
  }

  rebuild(): Effect.Effect<ToolResult<DuckDbIndexRebuildResult>, never, Clock.Clock> {
    if (!this.enabled) {
      return Effect.succeed({
        ok: true,
        data: {
          enabled: false,
          implementation: DISABLED_IMPLEMENTATION,
          filesScanned: 0,
          linesScanned: 0,
          recordsIndexed: 0,
          indexPath: this.indexPath,
        },
        warnings: [disabledWarning()],
      })
    }

    return Effect.succeed({
      ok: true,
      data: {
        enabled: true,
        implementation: DUCKDB_IMPLEMENTATION,
        rebuiltAt: new Date().toISOString(),
        filesScanned: 0,
        linesScanned: 0,
        recordsIndexed: 0,
        indexPath: this.indexPath,
      },
    })
  }

  query(
    input: DuckDbIndexQueryInput = {}
  ): Effect.Effect<ToolResult<DuckDbIndexQueryResult>, never> {
    if (!this.enabled) {
      return Effect.succeed({
        ok: true,
        data: { items: [], hasMore: false },
        warnings: [disabledWarning()],
      })
    }

    return Effect.catchAll(
      Effect.tryPromise({
        try: () => this.queryViaDuckDb(input),
        catch: (cause) => causeToIndexFailure(cause),
      }),
      (failure) => Effect.succeed(failure)
    )
  }

  private async queryViaDuckDb(
    input: DuckDbIndexQueryInput
  ): Promise<ToolResult<DuckDbIndexQueryResult>> {
    const layout = resolveWorkspacePaths(this.workspaceRoot)
    const storageRoot = layout.storageRoot

    const { DuckDBInstance } = await import("@duckdb/node-api").catch(() => {
      throw indexError("DuckDB is not available; install @duckdb/node-api.", {
        suggestion: "npm install @duckdb/node-api",
      })
    })

    const db = await DuckDBInstance.create(":memory:")
    const conn = await db.connect()

    try {
      const queryLimit = normalizeQueryLimit(input.limit, this.queryLimit)
      const sqlConditions: string[] = []

      if (input.id !== undefined) {
        sqlConditions.push(`id = '${escapeSqlString(input.id)}'`)
      }
      if (input.kind !== undefined) {
        sqlConditions.push(`kind = '${escapeSqlString(input.kind)}'`)
      }

      const whereClause = sqlConditions.length > 0 ? `WHERE ${sqlConditions.join(" AND ")}` : ""

      const sql = `
        SELECT *, filename
        FROM read_json_auto(
          '${storageRoot}/*.jsonl',
          format='newline_delimited',
          maximum_object_size=${this.maxInputLines * 1024}
        )
        ${whereClause}
      `

      const reader = await conn.runAndReadAll(sql)
      await reader.readAll()
      const allRows = reader.getRowObjectsJson() as Record<string, unknown>[]

      const searchText =
        input.text !== undefined && input.text.trim().length > 0
          ? input.text.trim().toLowerCase()
          : undefined

      const filtered = allRows.filter((row) => {
        if (input.includeDeleted !== true) {
          const deletedAt = row.deletedAt
          if (typeof deletedAt === "string" && deletedAt.length > 0) {
            return false
          }
        }
        return searchText === undefined || JSON.stringify(row).toLowerCase().includes(searchText)
      })

      const hasMore = filtered.length > queryLimit
      const sliced = hasMore ? filtered.slice(0, queryLimit) : filtered
      const items = sliced.map((row) => rowToIndexedRecord(row, storageRoot))

      const warnings: ToolWarning[] = []
      if (hasMore) {
        warnings.push({
          code: "has_more",
          message: `DuckDB index query returned the maximum ${queryLimit} records.`,
          details: { hasMore: true, limit: queryLimit },
        })
      }

      return {
        ok: true,
        data: { items, hasMore },
        ...(warnings.length === 0 ? {} : { warnings }),
      }
    } finally {
      conn.closeSync()
    }
  }
}

export const rebuildDuckDbIndex = (
  input: DuckDbIndexOptions
): Effect.Effect<ToolResult<DuckDbIndexRebuildResult>, never, Clock.Clock> =>
  new DuckDbIndex(input).rebuild()

const rowToIndexedRecord = (row: Record<string, unknown>, storageRoot: string): IndexedRecord => {
  const id = typeof row.id === "string" ? row.id : String(row.id ?? "")
  const kind = typeof row.kind === "string" ? row.kind : String(row.kind ?? "")
  const filePath = typeof row.filename === "string" ? row.filename : storageRoot
  const line = 0

  const { filename: _filename, ...record } = row

  return {
    id,
    kind,
    filePath,
    line,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    deletedAt: typeof row.deletedAt === "string" ? row.deletedAt : undefined,
    record: record as Record<string, unknown>,
  }
}

const normalizeQueryLimit = (
  requestedLimit: number | undefined,
  configuredLimit: number
): number => {
  if (requestedLimit === undefined || !Number.isFinite(requestedLimit)) {
    return configuredLimit
  }
  return Math.max(0, Math.min(Math.trunc(requestedLimit), configuredLimit))
}

const escapeSqlString = (value: string): string => value.replaceAll("'", "''")

const disabledWarning = (): ToolWarning => ({
  code: "index_disabled",
  message: "DuckDB index is disabled; canonical JSONL remains the source of truth.",
  details: {
    rebuild: "Create a DuckDbIndex with enabled: true and call rebuild().",
  },
})

const causeToIndexFailure = (cause: unknown): IndexFailure =>
  isToolResultFailure(cause)
    ? cause
    : indexError("DuckDB index operation failed.", { cause: String(cause) })

const indexError = (message: string, details?: Record<string, unknown>): IndexFailure => ({
  ok: false,
  error: {
    code: "index_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})

const isToolResultFailure = (value: unknown): value is IndexFailure =>
  isObjectRecord(value) &&
  value.ok === false &&
  isObjectRecord(value.error) &&
  value.error.code === "index_error"

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
