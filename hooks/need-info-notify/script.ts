#!/usr/bin/env bun
import { readFile } from "node:fs/promises"

const taskId = process.env.LOGBOOK_TASK_ID ?? ""
const dataFile = process.env.LOGBOOK_TASKS_FILE ?? "./tasks.jsonl"

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
  timestamp: string
  title: string
  content: string
  reply: string
  kind: string
}

interface RawTask {
  id: string
  comments: RawComment[]
}

const parseTask = (line: string): RawTask | null => {
  try {
    return JSON.parse(line) as RawTask
  } catch {
    return null
  }
}

const findBlockingComment = (task: RawTask): RawComment | null => {
  // Find the most recent need_info comment with an empty reply
  for (let i = task.comments.length - 1; i >= 0; i--) {
    const comment = task.comments[i]
    if (comment !== undefined && comment.kind === "need_info" && comment.reply === "") {
      return comment
    }
  }
  return null
}

const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT"

const lines = await readLines(dataFile)

let found: RawTask | null = null
for (const line of lines) {
  const task = parseTask(line)
  if (task !== null && task.id === taskId) {
    found = task
    break
  }
}

if (found === null) process.exit(0)

const comment = findBlockingComment(found)
if (comment === null) process.exit(0)

process.stdout.write(`[need_info] Task ${taskId}: ${comment.title}\n${comment.content}\n`)
