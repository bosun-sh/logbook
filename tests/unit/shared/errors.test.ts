import { describe, expect, test } from "bun:test"
import type { ToolResult } from "@logbook/shared/result.js"

describe("ToolResult", () => {
  test("success envelopes carry data and warnings", () => {
    const result: ToolResult<{ id: string }> = {
      ok: true,
      data: { id: "task_01" },
      warnings: [
        {
          code: "has_more",
          message: "Additional records are available through a cursor",
          details: { cursor: "task.list:next" },
        },
      ],
    }

    expect(result).toEqual({
      ok: true,
      data: { id: "task_01" },
      warnings: [
        {
          code: "has_more",
          message: "Additional records are available through a cursor",
          details: { cursor: "task.list:next" },
        },
      ],
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  test("failure envelopes carry structured errors", () => {
    const result: ToolResult<never> = {
      ok: false,
      error: {
        code: "validation_error",
        message: "title is required",
        details: { field: "title" },
      },
    }

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
      expect(result.error.message).toBe("title is required")
      expect(result.error.details).toEqual({ field: "title" })
    }
    expect(() => JSON.stringify(result)).not.toThrow()
  })
})
