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
  test("includes allowed transitions and corrective hint", () => {
    const err: TaskError = { _tag: "transition_not_allowed", from: "backlog", to: "done" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32002)
    expect(result.message).toContain("cannot move from 'backlog' to 'done'")
    expect(result.message).toContain("Allowed transitions from 'backlog': todo")
    expect(result.message).toContain("To proceed: transition to")
    expect(result.data.from).toBe("backlog")
    expect(result.data.to).toBe("done")
    expect(result.data.allowedTo).toEqual(["todo"])
    expect(result.data.normalFlow).toContain("backlog → todo → in_progress")
    expect(result.data.isReviewTask).toBe(false)
    expect(result.data.hint).toContain("Try transitioning to todo first")
  })

  test("detects review task and shows review flow hint", () => {
    const err: TaskError = {
      _tag: "transition_not_allowed",
      from: "done",
      to: "in_progress",
      taskId: "review-1",
    }
    const result = taskErrorToMcpError(err)
    expect(result.data.isReviewTask).toBe(true)
    expect(result.data.taskId).toBe("review-1")
    expect(result.message).toContain("Review tasks")
  })

  test("terminal status has no allowed transitions", () => {
    const err: TaskError = { _tag: "transition_not_allowed", from: "done", to: "backlog" }
    const result = taskErrorToMcpError(err)
    expect(result.data.allowedTo).toEqual([])
    expect(result.message).toContain("This status is terminal")
  })
})

describe("taskErrorToMcpError / validation_error", () => {
  test("unknown message passes through unchanged", () => {
    const err: TaskError = { _tag: "validation_error", message: "field is required" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toBe("field is required")
    expect(result.data.message).toBe("field is required")
  })

  test("concurrent in_progress guard includes task list", () => {
    const err: TaskError = {
      _tag: "validation_error",
      message: "moving a second task to in_progress requires a justification comment",
      context: {
        inProgressTasks: [{ id: "task-1", title: "Existing task" }],
      },
    }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toContain("another task is already in_progress")
    expect(result.message).toContain("Existing task (id: task-1)")
    expect(result.message).toContain("Include a non-empty comment explaining the priority change")
  })

  test("reply on regular comment includes comment details", () => {
    const err: TaskError = {
      _tag: "validation_error",
      message: "reply is only valid on need_info comments",
      context: { commentId: "c-1", commentKind: "regular" },
    }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toContain("Cannot reply to this comment")
    expect(result.message).toContain("Comment id: c-1")
    expect(result.message).toContain("Comment kind: regular")
  })

  test("blocking comment without reply includes comment info", () => {
    const err: TaskError = {
      _tag: "validation_error",
      message: "blocking comment c-42 has no reply",
      context: {
        commentId: "c-42",
        commentTitle: "Waiting for approval",
        commentContent: "Need manager sign-off before proceeding with the deployment",
        commentTimestamp: new Date("2025-01-15T10:00:00Z"),
      },
    }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toContain("blocking comment has no reply")
    expect(result.message).toContain("id: c-42")
    expect(result.message).toContain("title: Waiting for approval")
    expect(result.message).toContain("Need manager sign-off before proceeding")
    expect(result.message).toContain("Include a reply")
  })

  test("empty blocked content explains requirement", () => {
    const err: TaskError = {
      _tag: "validation_error",
      message: "blocked requires a non-empty comment",
      context: { from: "in_progress", to: "blocked" },
    }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32003)
    expect(result.message).toContain("Cannot transition to blocked with an empty comment")
    expect(result.message).toContain("Include a non-empty comment")
  })
})

describe("taskErrorToMcpError / missing_comment", () => {
  test("includes transition context when available", () => {
    const err: TaskError = { _tag: "missing_comment", from: "in_progress", to: "need_info" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32004)
    expect(result.message).toContain("A comment is required")
    expect(result.message).toContain("in_progress → need_info")
    expect(result.message).toContain("need_info status requires documentation")
    expect(result.data).toEqual({ from: "in_progress", to: "need_info" })
  })

  test("includes blocked context", () => {
    const err: TaskError = { _tag: "missing_comment", from: "in_progress", to: "blocked" }
    const result = taskErrorToMcpError(err)
    expect(result.message).toContain("blocked status requires documentation")
    expect(result.data).toEqual({ from: "in_progress", to: "blocked" })
  })

  test("works without transition context (backward compat)", () => {
    const err: TaskError = { _tag: "missing_comment" }
    const result = taskErrorToMcpError(err)
    expect(result.code).toBe(-32004)
    expect(result.message).toContain("A comment is required")
    expect(result.data).toEqual({ from: undefined, to: undefined })
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
