import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
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
})
