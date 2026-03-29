import { describe, expect, test } from "bun:test"
import type { TaskError } from "@logbook/domain/types.js"
import { taskErrorToMcpError } from "@logbook/mcp/error-codes.js"

describe("taskErrorToMcpError / not_found", () => {
  test("maps to code -32001 with taskId in data", () => {
    const err: TaskError = { _tag: "not_found", taskId: "task-42" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32001)
    expect(result.message).toBe("Task not found")
    expect(result.data).toEqual({ taskId: "task-42" })
  })
})

describe("taskErrorToMcpError / transition_not_allowed", () => {
  test("maps to code -32002 with from/to in data", () => {
    const err: TaskError = { _tag: "transition_not_allowed", from: "backlog", to: "done" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32002)
    expect(result.message).toBe("Status transition not allowed")
    expect(result.data).toEqual({ from: "backlog", to: "done" })
  })
})

describe("taskErrorToMcpError / validation_error", () => {
  test("maps to code -32003 with message in data", () => {
    const err: TaskError = { _tag: "validation_error", message: "field is required" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toBe("Validation error")
    expect(result.data).toEqual({ message: "field is required" })
  })
})

describe("taskErrorToMcpError / missing_comment", () => {
  test("maps to code -32004 with empty data", () => {
    const err: TaskError = { _tag: "missing_comment" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32004)
    expect(result.message).toBe("A comment is required for this transition")
    expect(result.data).toEqual({})
  })
})

describe("taskErrorToMcpError / conflict", () => {
  test("maps to code -32005 with taskId in data", () => {
    const err: TaskError = { _tag: "conflict", taskId: "task-7" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32005)
    expect(result.message).toBe("Task already exists")
    expect(result.data).toEqual({ taskId: "task-7" })
  })
})

describe("taskErrorToMcpError / no_current_task", () => {
  test("maps to code -32006 with empty data", () => {
    const err: TaskError = { _tag: "no_current_task" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32006)
    expect(result.message).toBe("No current task for this session")
    expect(result.data).toEqual({})
  })
})
