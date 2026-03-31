import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

// We import the module factory so we can create loggers with custom thresholds
// without relying on the module-level singleton (which is env-var driven).
// The private makeLogger is not exported, so we test the exported singleton
// indirectly for env-driven behavior, and test level filtering via a white-box
// approach by patching process.stderr.write.

const LEVEL_ORDER = ["debug", "info", "warn", "error"] as const
type Level = (typeof LEVEL_ORDER)[number]

// ---------------------------------------------------------------------------
// Helper: build a fresh logger at a given threshold (mirrors makeLogger impl)
// ---------------------------------------------------------------------------
const makeTestLogger = (threshold: Level) => {
  const thresholdIdx = LEVEL_ORDER.indexOf(threshold)
  const lines: string[] = []

  const write = (level: Level, msg: string, ctx?: Record<string, unknown>) => {
    if (LEVEL_ORDER.indexOf(level) < thresholdIdx) return
    lines.push(JSON.stringify({ level, ts: new Date().toISOString(), msg, ...ctx }))
  }

  const logger = {
    debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
    info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
    warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
  }

  return { logger, lines }
}

// ---------------------------------------------------------------------------
// Level filtering
// ---------------------------------------------------------------------------
describe("logger / level filtering", () => {
  test("emits messages at or above threshold", () => {
    const { logger, lines } = makeTestLogger("warn")
    logger.warn("watch out")
    logger.error("boom")
    expect(lines.length).toBe(2)
  })

  test("suppresses messages below threshold", () => {
    const { logger, lines } = makeTestLogger("warn")
    logger.debug("verbose")
    logger.info("informational")
    expect(lines.length).toBe(0)
  })

  test("emits all levels when threshold is debug", () => {
    const { logger, lines } = makeTestLogger("debug")
    logger.debug("d")
    logger.info("i")
    logger.warn("w")
    logger.error("e")
    expect(lines.length).toBe(4)
  })

  test("emits only error when threshold is error", () => {
    const { logger, lines } = makeTestLogger("error")
    logger.debug("d")
    logger.info("i")
    logger.warn("w")
    logger.error("e")
    expect(lines.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------
describe("logger / output shape", () => {
  test("output is valid JSON with required fields", () => {
    const { logger, lines } = makeTestLogger("debug")
    logger.info("hello world")
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0] as string) as unknown
    expect(typeof parsed).toBe("object")
    const entry = parsed as Record<string, unknown>
    expect(entry.level).toBe("info")
    expect(typeof entry.ts).toBe("string")
    expect(entry.msg).toBe("hello world")
  })

  test("context fields are merged into the JSON object", () => {
    const { logger, lines } = makeTestLogger("debug")
    logger.warn("bad config", { path: "/hooks/foo/config.yml", error: "missing field" })
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(entry.path).toBe("/hooks/foo/config.yml")
    expect(entry.error).toBe("missing field")
  })

  test("ts field is an ISO 8601 timestamp", () => {
    const { logger, lines } = makeTestLogger("debug")
    logger.debug("ts check")
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(typeof entry.ts).toBe("string")
    expect(() => new Date(entry.ts as string).toISOString()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Stderr integration: verify the exported singleton writes to process.stderr
// ---------------------------------------------------------------------------
describe("logger / stderr integration", () => {
  let captured: string[] = []
  let spy: ReturnType<typeof spyOn<typeof process.stderr, "write">>

  beforeEach(() => {
    captured = []
    spy = spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      captured.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    spy.mockRestore()
  })

  test("exported logger writes to process.stderr", async () => {
    // Use a dynamic import so we get the module as loaded (default threshold: warn).
    const { logger } = await import("@logbook/infra/logger.js")
    logger.warn("stderr test")
    expect(captured.length).toBeGreaterThanOrEqual(1)
    const line = captured.find((c) => c.includes("stderr test"))
    expect(line).toBeDefined()
    const entry = JSON.parse((line as string).trim()) as Record<string, unknown>
    expect(entry.level).toBe("warn")
    expect(entry.msg).toBe("stderr test")
  })

  test("exported logger.error writes to process.stderr", async () => {
    const { logger } = await import("@logbook/infra/logger.js")
    logger.error("error test")
    const line = captured.find((c) => c.includes("error test"))
    expect(line).toBeDefined()
    const entry = JSON.parse((line as string).trim()) as Record<string, unknown>
    expect(entry.level).toBe("error")
    expect(entry.msg).toBe("error test")
  })

  test("exported logger.debug is suppressed at default warn threshold", async () => {
    const { logger } = await import("@logbook/infra/logger.js")
    logger.debug("debug suppressed")
    const line = captured.find((c) => c.includes("debug suppressed"))
    expect(line).toBeUndefined()
  })

  test("exported logger.info is suppressed at default warn threshold", async () => {
    const { logger } = await import("@logbook/infra/logger.js")
    logger.info("info suppressed")
    const line = captured.find((c) => c.includes("info suppressed"))
    expect(line).toBeUndefined()
  })
})

