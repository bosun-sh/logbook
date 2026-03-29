import type { TaskError } from "../domain/types.js"

export interface McpError {
  code: number
  message: string
  data: Record<string, unknown>
}

export const taskErrorToMcpError = (err: TaskError): McpError => {
  switch (err._tag) {
    case "not_found":
      return { code: -32001, message: "Task not found", data: { taskId: err.taskId } }
    case "transition_not_allowed":
      return {
        code: -32002,
        message: "Status transition not allowed",
        data: { from: err.from, to: err.to },
      }
    case "validation_error":
      return { code: -32003, message: "Validation error", data: { message: err.message } }
    case "missing_comment":
      return { code: -32004, message: "A comment is required for this transition", data: {} }
    case "conflict":
      return { code: -32005, message: "Task already exists", data: { taskId: err.taskId } }
    case "no_current_task":
      return { code: -32006, message: "No current task for this session", data: {} }
  }
}
