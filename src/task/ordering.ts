import { appendTaskReply as appendReply } from "./comments.js"
import type { Task } from "./schema.js"

export const appendTaskReply = appendReply

export const compareTasksForList = (left: Task, right: Task): number => {
  const priority = right.priority - left.priority
  if (priority !== 0) {
    return priority
  }

  const updatedAt = right.updatedAt.localeCompare(left.updatedAt)
  if (updatedAt !== 0) {
    return updatedAt
  }

  return left.id.localeCompare(right.id)
}
