import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_ENTRY = join(import.meta.dir, "../../src/mcp/server.ts")

const runInit = async (cwd: string): Promise<{ exitCode: number; stdout: string }> => {
  const proc = Bun.spawn(["bun", "run", SERVER_ENTRY, "init"], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  return { exitCode, stdout }
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let tmpDir = ""

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = ""
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("logbook-mcp init", () => {
  test("exits 0 in an empty directory", async () => {
    tmpDir = await mkdir(join(tmpdir(), `logbook-init-${Date.now()}`), { recursive: true }).then(
      () => join(tmpdir(), `logbook-init-${Date.now() - 1}`)
    )
    // Create the dir properly
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const { exitCode } = await runInit(tmpDir)
    expect(exitCode).toBe(0)
  })

  test("creates tasks.jsonl and hooks/ directory", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    await runInit(tmpDir)

    expect(await pathExists(join(tmpDir, "tasks.jsonl"))).toBe(true)
    expect(await pathExists(join(tmpDir, "hooks"))).toBe(true)
  })

  test("stdout contains Claude Code config snippet", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const { stdout } = await runInit(tmpDir)

    expect(stdout).toContain("Claude Code — add to .claude/settings.json:")
    expect(stdout).toContain('"logbook"')
    expect(stdout).toContain('"command": "logbook-mcp"')
  })

  test("stdout contains OpenCode config snippet", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const { stdout } = await runInit(tmpDir)

    expect(stdout).toContain("OpenCode — add to opencode.json:")
    expect(stdout).toContain('"type": "local"')
    expect(stdout).toContain('"enabled": true')
  })

  test("stdout contains .gitignore snippet", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const { stdout } = await runInit(tmpDir)

    expect(stdout).toContain(".gitignore — add these runtime files:")
    expect(stdout).toContain("tasks.jsonl")
    expect(stdout).toContain("sessions.json")
  })

  test("stdout contains next steps", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const { stdout } = await runInit(tmpDir)

    expect(stdout).toContain("Next steps:")
    expect(stdout).toContain("quickstart.md")
  })

  test("is idempotent — second run exits 0 without overwriting", async () => {
    tmpDir = join(tmpdir(), `logbook-init-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })

    const first = await runInit(tmpDir)
    expect(first.exitCode).toBe(0)

    const second = await runInit(tmpDir)
    expect(second.exitCode).toBe(0)

    // Skipping messages present on second run
    expect(second.stdout).toContain("already exists, skipping")
  })
})
