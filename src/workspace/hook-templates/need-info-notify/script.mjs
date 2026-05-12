#!/usr/bin/env node
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

const findBlockingComment = (task) => {
  for (let i = task.comments.length - 1; i >= 0; i--) {
    const comment = task.comments[i]
    if (
      comment !== undefined &&
      comment.kind === "need_info" &&
      (comment.replies === undefined || comment.replies.length === 0)
    ) {
      return comment
    }
  }
  return null
}

const isEnoent = (e) => typeof e === "object" && e !== null && e.code === "ENOENT"

const lines = await readLines(dataFile)

let found = null
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
