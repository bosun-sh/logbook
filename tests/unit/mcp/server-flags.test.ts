import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

describe("logbook-mcp CLI flags", () => {
  test("--version flag outputs version and exits 0", () => {
    const result = spawnSync("bun", ["src/mcp/server.ts", "--version"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })

  test("-v flag outputs version and exits 0", () => {
    const result = spawnSync("bun", ["src/mcp/server.ts", "-v"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
  })

  test("--help flag outputs help text and exits 0", () => {
    const result = spawnSync("bun", ["src/mcp/server.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("logbook-mcp")
    expect(result.stdout).toContain("Commands:")
    expect(result.stdout).toContain("Options:")
    expect(result.stdout).toContain("--version")
    expect(result.stdout).toContain("--help")
  })

  test("-h flag outputs help text and exits 0", () => {
    const result = spawnSync("bun", ["src/mcp/server.ts", "-h"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("logbook-mcp")
    expect(result.stdout).toContain("Commands:")
    expect(result.stdout).toContain("Options:")
  })
})
