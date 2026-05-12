#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const taskId = process.env.LOGBOOK_TASK_ID ?? ""
const workspaceRoot = process.env.LOGBOOK_WORKSPACE_ROOT ?? process.cwd()
const dataFile = join(workspaceRoot, ".logbook", "storage", "tasks.jsonl")

if (taskId === "") process.exit(0)

const readLines = async (filePath) => {
  const content = await readFile(filePath, "utf8").catch((e) => {
    if (isEnoent(e)) return ""
    throw e
  })
  return content.split("\n").filter((l) => l.trim() !== "")
}

const parseTask = (line) => {
  try {
    const parsed = JSON.parse(line)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      parsed.kind === "task"
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

const isEnoent = (e) => typeof e === "object" && e !== null && e.code === "ENOENT"

const lines = await readLines(dataFile)

let original = null
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
    "task:create",
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
