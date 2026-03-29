#!/usr/bin/env bun
import { readFile, appendFile } from "node:fs/promises"

const taskId   = process.env['LOGBOOK_TASK_ID']    ?? ''
const dataFile = process.env['LOGBOOK_TASKS_FILE'] ?? './tasks.jsonl'

if (taskId === '') process.exit(0)

const readLines = async (filePath: string): Promise<readonly string[]> => {
  const content = await readFile(filePath, "utf8").catch((e: unknown) => {
    if (isEnoent(e)) return ""
    throw e
  })
  return content.split("\n").filter(l => l.trim() !== "")
}

interface RawAgent {
  id:          string
  title:       string
  description: string
}

interface RawTask {
  project:            string
  milestone:          string
  id:                 string
  title:              string
  definition_of_done: string
  description:        string
  estimation:         number
  comments:           unknown[]
  assignee:           RawAgent
  status:             string
  in_progress_since?: string
}

const parseTask = (line: string): RawTask | null => {
  try {
    return JSON.parse(line) as RawTask
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

const reviewId = `review-${original.id}`

// Idempotency check: skip if a task with the review id already exists
const alreadyExists = lines.some(line => {
  const task = parseTask(line)
  return task !== null && task.id === reviewId
})

if (alreadyExists) process.exit(0)

const reviewTask: RawTask = {
  project:            original.project,
  milestone:          original.milestone,
  id:                 reviewId,
  title:              `Review: ${original.title}`,
  definition_of_done: "Review approved",
  description:        `Review task for ${original.id}`,
  estimation:         1,
  comments:           [],
  assignee:           original.assignee,
  status:             "todo",
}

await appendFile(dataFile, JSON.stringify(reviewTask) + "\n", "utf8")

const { execSync } = await import("node:child_process")
const path = await import("node:path")
const projectRoot = path.dirname(path.dirname(path.dirname(import.meta.url.replace("file://", ""))))
const mcpConfig = path.join(projectRoot, ".claude/mcp-config.json")
execSync(
  `claude --model claude-haiku-4-5-20251001 --mcp-config ${mcpConfig} --agent reviewer --task "review task ${reviewId}"`,
  { stdio: "inherit", env: { ...process.env, LOGBOOK_TASKS_FILE: dataFile } }
)
