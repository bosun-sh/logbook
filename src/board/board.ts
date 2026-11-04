import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import type { Task } from "@logbook/task/schema.js"
import { TaskRepository } from "@logbook/workspace/repositories.js"
import { Effect } from "effect"
import { discoverBoards } from "./discover.js"
import { renderBoardHtml } from "./render.js"

const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "need_info",
  "blocked",
  "pending_review",
  "done",
  "canceled",
] as const
type TaskStatus = (typeof STATUSES)[number]
type Warning = {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

export type BoardInput = {
  readonly root?: string | undefined
  readonly out?: string | undefined
  readonly open?: boolean | undefined
}

export type BoardResult = {
  readonly outFile: string
  readonly boards: {
    readonly label: string
    readonly root: string
    readonly total: number
    readonly waiting: number
    readonly byStatus: Record<TaskStatus, number>
  }[]
}

const opener = (): [string, string[]] =>
  process.platform === "darwin"
    ? ["open", []]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", '""']]
      : ["xdg-open", []]

const openFile = (file: string): Promise<string | undefined> =>
  new Promise((done) => {
    const [cmd, args] = opener()
    const child = spawn(cmd, [...args, file], { detached: true, stdio: "ignore" })
    child.once("error", (e) => done(String(e)))
    child.once("spawn", () => {
      child.unref()
      done(undefined)
    })
  })

const renderBoardUnsafe = async (input: BoardInput): Promise<ToolResult<BoardResult>> => {
  const root = resolve(input.root ?? process.cwd())
  const outFile = resolve(input.out ?? join(homedir(), ".cache", "logbook", "board.html"))
  const warnings: Warning[] = []
  const pageWarnings: { label: string; message: string }[] = []
  const pageBoards: { label: string; tasks: Task[] }[] = []
  const summaries: BoardResult["boards"] = []

  const found = await discoverBoards(root)
  if (found.length === 0) {
    warnings.push({ code: "board_none_found", message: `No logbook boards found under ${root}.` })
  }
  for (const board of found) {
    const result = await Effect.runPromiseExit(
      new TaskRepository({ workspaceRoot: board.root }).list()
    )
    if (result._tag === "Failure") {
      const cause = String(result.cause)
      warnings.push({
        code: "board_load_failed",
        message: `Failed to read board ${board.label}.`,
        details: { label: board.label, cause },
      })
      pageWarnings.push({ label: board.label, message: cause.slice(0, 500) })
      continue
    }
    const tasks = [...result.value]
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>
    for (const t of tasks) byStatus[t.status] += 1
    pageBoards.push({ label: board.label, tasks })
    summaries.push({
      label: board.label,
      root: board.root,
      total: tasks.length,
      waiting: byStatus.need_info + byStatus.blocked + byStatus.pending_review,
      byStatus,
    })
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(
    outFile,
    renderBoardHtml({
      generatedAt: new Date().toISOString(),
      boards: pageBoards,
      warnings: pageWarnings,
    })
  )
  if (input.open === true) {
    const failure = await openFile(outFile)
    if (failure !== undefined) {
      warnings.push({ code: "board_open_failed", message: `Could not open ${outFile}: ${failure}` })
    }
  }
  return {
    ok: true,
    data: { outFile, boards: summaries },
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

export const renderBoard = (
  input: BoardInput = {}
): Effect.Effect<ToolResult<BoardResult>, never> =>
  Effect.tryPromise({
    try: () => renderBoardUnsafe(input),
    catch: (cause) => ({
      code: "board_render_failed",
      message: "Failed to render board.",
      details: { cause: String(cause) },
    }),
  }).pipe(Effect.catchAll((error) => Effect.succeed({ ok: false as const, error })))
