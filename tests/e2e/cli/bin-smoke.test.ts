import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BIN_CLI_ENTRY = join(import.meta.dir, "../../../src/workspace/bin-cli.ts")

const runCli = async (
  args: string[],
  options: { workspaceRoot?: string; stdin?: string } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
  )
  if (options.workspaceRoot) {
    env.LOGBOOK_WORKSPACE_ROOT = options.workspaceRoot
  }

  const proc = Bun.spawn(["bun", "run", BIN_CLI_ENTRY, ...args], {
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stdout, stderr }
}

describe("bin-cli smoke tests", () => {
  let workspaceRoot: string | undefined

  afterEach(async () => {
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("workspace:init creates v2 workspace layout", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-cli-"))

    const { exitCode, stdout } = await runCli(["workspace:init", `--path=${workspaceRoot}`])

    const result = JSON.parse(stdout) as Record<string, unknown>
    expect(exitCode).toBe(0)
    expect(result.ok).toBe(true)
    const data = result.data as Record<string, unknown>
    expect((data.workspace as Record<string, unknown>).schemaVersion).toBe(2)
  })

  test("init runs one-command onboarding without Linear or MCP setup", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-cli-init-"))

    const { exitCode, stdout } = await runCli([
      "init",
      `--path=${workspaceRoot}`,
      "--mcp-client=none",
      "--no-linear",
    ])

    expect(exitCode).toBe(0)
    expect(stdout).toContain("Workspace ready")
    expect(stdout).toContain("MCP setup skipped")
    expect(stdout).toContain("Linear setup skipped")
    await expect(readFile(join(workspaceRoot, ".logbook/config.json"), "utf8")).resolves.toContain(
      '"schemaVersion": "2"'
    )
  })

  test("init writes Claude Code MCP config", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-cli-claude-"))
    await mkdir(join(workspaceRoot, ".claude"), { recursive: true })
    await writeFile(
      join(workspaceRoot, ".claude/settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git status)"] } }, null, 2),
      "utf8"
    )

    const { exitCode } = await runCli([
      "init",
      `--path=${workspaceRoot}`,
      "--mcp-client=claude",
      "--no-linear",
    ])

    expect(exitCode).toBe(0)
    const settings = JSON.parse(
      await readFile(join(workspaceRoot, ".claude/settings.json"), "utf8")
    ) as Record<string, any>
    expect(settings.permissions).toEqual({ allow: ["Bash(git status)"] })
    expect(settings.mcpServers.logbook).toEqual({ command: "logbook", args: ["mcp"] })
  })

  test("init writes OpenCode MCP config", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-cli-opencode-"))
    await writeFile(
      join(workspaceRoot, "opencode.json"),
      JSON.stringify({ theme: "system" }, null, 2),
      "utf8"
    )

    const { exitCode } = await runCli([
      "init",
      `--path=${workspaceRoot}`,
      "--mcp-client=opencode",
      "--no-linear",
    ])

    expect(exitCode).toBe(0)
    const config = JSON.parse(
      await readFile(join(workspaceRoot, "opencode.json"), "utf8")
    ) as Record<string, any>
    expect(config.theme).toBe("system")
    expect(config.mcp.logbook).toEqual({
      type: "local",
      command: ["logbook", "mcp"],
      enabled: true,
    })
  })

  test("task.create returns task with backlog status", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-cli-create-"))
    await mkdir(join(workspaceRoot, ".logbook/storage"), { recursive: true })
    await runCli(["workspace:init", `--path=${workspaceRoot}`, "--migrateV1=false"])

    const { exitCode, stdout } = await runCli(
      [
        "task:create",
        "--title=Smoke test task",
        "--description=Created by bin-cli smoke test",
        "--definitionOfDone=Task is done",
        "--project=smoke",
        "--milestone=v1",
        "--predictedKTokens=1",
      ],
      { workspaceRoot }
    )

    const result = JSON.parse(stdout) as Record<string, unknown>
    expect(exitCode).toBe(0)
    expect(result.ok).toBe(true)
    const task = (result.data as Record<string, unknown>).task as Record<string, unknown>
    expect(task.kind).toBe("task")
    expect(task.status).toBe("backlog")
    expect(task.title).toBe("Smoke test task")
  })

  test("unknown command returns error with exit code 1", async () => {
    const { exitCode, stdout } = await runCli(["nonexistent.command"])

    const result = JSON.parse(stdout) as Record<string, unknown>
    expect(exitCode).toBe(1)
    expect(result.ok).toBe(false)
  })

  test("help and version flags print public CLI affordances", async () => {
    const help = await runCli(["--help"])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("logbook mcp")
    expect(help.stdout).toContain("logbook --version")

    const version = await runCli(["--version"])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.trim()).toBe("2.0.0")
  })
})
