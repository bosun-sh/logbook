import { describe, expect, test } from "bun:test"
import { defaultTaskEstimate } from "@logbook/task/estimate.js"

const allowedFibonacci = new Set([1, 2, 3, 5, 8, 13, 21])

describe("defaultTaskEstimate", () => {
  test("calculates a valid Fibonacci estimate and preserves complexity", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 8,
      complexity: "medium",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected estimate calculation to succeed")
    }

    expect(result.data.predictedKTokens).toBe(8)
    expect(result.data.complexity).toBe("medium")
    expect(allowedFibonacci.has(result.data.fibonacci)).toBe(true)
    expect(result.data.confidence).toBe("low")
    expect(result.data.rationale).toBeUndefined()
  })

  test("stores explicit confidence and rationale", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 13,
      complexity: "large",
      confidence: "high",
      rationale: "This work is bounded and well understood.",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected estimate calculation to succeed")
    }

    expect(result.data.confidence).toBe("high")
    expect(result.data.rationale).toBe("This work is bounded and well understood.")
  })

  test("rejects non-positive predictedKTokens", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 0,
      complexity: "small",
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: "predictedKTokens must be positive",
      },
    })
  })

  test("preserves predictions at and above the former cap with token bucket 21", () => {
    for (const predictedKTokens of [64, 65, 128]) {
      expect(defaultTaskEstimate({ predictedKTokens, complexity: "large" })).toMatchObject({
        ok: true,
        data: { predictedKTokens, fibonacci: 21 },
      })
    }
  })

  test("retains finite positive integer command validation", () => {
    for (const predictedKTokens of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, "128"]) {
      expect(
        defaultTaskEstimate({ predictedKTokens: predictedKTokens as number, complexity: "small" })
      ).toMatchObject({ ok: false, error: { code: "validation_error" } })
    }
  })

  test("rejects rationale values above the byte limit", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 5,
      complexity: "small",
      rationale: "a".repeat(4097),
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: "rationale exceeds 4096 bytes",
      },
    })
    expect(
      defaultTaskEstimate({
        predictedKTokens: 128,
        complexity: "large",
        rationale: "é".repeat(2048),
      })
    ).toMatchObject({ ok: true })
    expect(
      defaultTaskEstimate({
        predictedKTokens: 128,
        complexity: "large",
        rationale: "é".repeat(2049),
      })
    ).toMatchObject({ ok: false, error: { code: "validation_error" } })
  })

  test("rejects missing complexity at runtime", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 5,
    } as never)

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: "complexity is required",
      },
    })
  })

  test("rejects invalid confidence values", () => {
    const result = defaultTaskEstimate({
      predictedKTokens: 5,
      complexity: "small",
      confidence: "urgent",
    } as never)

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
        message: "confidence must be low, medium, or high",
      },
    })
  })
})
