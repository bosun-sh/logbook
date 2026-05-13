import { describe, expect, test } from "bun:test"
import { validationError } from "@bosun-sh/ohtools"
import { toToolResult } from "@logbook/plugin/results.js"

describe("toToolResult", () => {
  test("wraps plain success data and truncates warnings to the public limit", () => {
    const warnings = Array.from({ length: 22 }, (_, index) => ({
      code: `warning_${index + 1}`,
      message: `warning ${index + 1}`,
    }))

    const result = toToolResult(
      {
        status: {
          ok: true,
        },
      },
      warnings
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected success result")
    }

    expect(result.warnings).toHaveLength(20)
    expect(result.warnings?.slice(0, 19)).toEqual(warnings.slice(0, 19))
    expect(result.warnings?.[19]).toEqual({
      code: "result_truncated",
      message: "Warnings exceeded the public result limit",
      details: {
        originalCount: 22,
        returnedCount: 20,
      },
    })
  })

  test("preserves failure codes and truncates oversized error details", () => {
    const result = toToolResult({
      ok: false,
      error: {
        code: "storage_error",
        message: "repository operation failed",
        details: {
          payload: "x".repeat(70_000),
        },
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: "storage_error",
        message: "repository operation failed",
        details: {
          truncated: true,
          maxBytes: 65_536,
        },
      },
    })
  })

  test("maps adapter schema failures to schema_validation_error", () => {
    const result = toToolResult(
      validationError(
        "tool input validation failed",
        [{ path: ["definitionOfDone"], message: "Required" }],
        { path: ["task.create"] }
      )
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: "schema_validation_error",
        message: "tool input validation failed",
        details: {
          issues: [{ path: ["definitionOfDone"], message: "Required" }],
          path: ["task.create"],
        },
      },
    })
  })

  test("keeps release-gate outputs in the public ToolResult envelope shape", () => {
    const success = toToolResult({
      checked: {
        specFiles: 42,
        publicToolIds: 38,
      },
    })
    const failure = toToolResult({
      ok: false,
      error: {
        code: "style_violation",
        message: "migration spec readiness failed",
        details: {
          failures: [{ file: "migration-spec/main.md", message: "missing `status: ready`" }],
        },
      },
    })

    expect(success).toEqual({
      ok: true,
      data: {
        checked: {
          specFiles: 42,
          publicToolIds: 38,
        },
      },
    })
    expect(failure).toMatchObject({
      ok: false,
      error: {
        code: "style_violation",
        details: {
          failures: [{ file: "migration-spec/main.md", message: "missing `status: ready`" }],
        },
      },
    })
  })
})
