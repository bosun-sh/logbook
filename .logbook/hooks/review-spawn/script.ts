#!/usr/bin/env bun
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const taskId = process.env.LOGBOOK_TASK_ID ?? ""
const workspaceRoot = process.env.LOGBOOK_WORKSPACE_ROOT ?? process.cwd()
const dataFile = join(workspaceRoot, ".logbook", "storage", "tasks.jsonl")

if (taskId === "") process.exit(0)

const readLines = async (filePath: string): Promise<readonly string[]> => {
  const content = await readFile(filePath, "utf8").catch((e: unknown) => {
    if (isEnoent(e)) return ""
    throw e
  })
  return content.split("\n").filter((l) => l.trim() !== "")
}

interface RawComment {
  id: string
  kind: string
  replies?: Array<{ content: string }>
}

interface RawTask {
  id: string
  kind: "task"
  project: string
  milestone: string
  title: string
  definitionOfDone: string
  description: string
  sessionId?: string
  model?: unknown
  estimate?: unknown
  comments: RawComment[]
  assignee?: unknown
  status: string
}

const parseTask = (line: string): RawTask | null => {
  try {
    const parsed = JSON.parse(line) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).kind === "task"
    ) {
      return parsed as RawTask
    }
    return null
  } catch {
    return null
  }
}

const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT"

const lines = await readLines(dataFile)

let original: RawTask | null = null
for (const line of lines) {
  const task = parseTask(line)
  if (task !== null && task.id === taskId) {
    original = task
    break
  }
}

if (original === null) process.exit(0)

if (original.id.startsWith("review-")) process.exit(0)

const reviewId = `review-${original.id}`

const alreadyExists = lines.some((line) => {
  const task = parseTask(line)
  return task !== null && task.id === reviewId
})

if (alreadyExists) process.exit(0)

const logbookBin = join(workspaceRoot, "node_modules", ".bin", "logbook")

execFileSync(
  logbookBin,
  [
    "task.create",
    `--title=Review: ${original.title}`,
    `--description=Review task for ${original.id}`,
    "--definitionOfDone=Review approved",
    `--project=${original.project}`,
    `--milestone=${original.milestone}`,
    "--predictedKTokens=1",
    `--id=${reviewId}`,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: workspaceRoot },
  }
)

const mcpConfig = join(workspaceRoot, ".claude", "mcp-config.json")
execFileSync(
  "claude",
  [
    "--model",
    "claude-haiku-4-5-20251001",
    "--mcp-config",
    mcpConfig,
    "--agent",
    "reviewer",
    "-p",
    `review task ${reviewId}`,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: workspaceRoot },
  }
)
