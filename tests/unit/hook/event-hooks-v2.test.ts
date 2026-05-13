import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listHooks } from "@logbook/hook/list.js"
import { runHook } from "@logbook/hook/run.js"
import { initWorkspace } from "@logbook/workspace/init.js"
import { Effect } from "effect"

let workspaceRoot: string | undefined
const originalCwd = process.cwd()

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-hooks-run-"))
  const result = await run(initWorkspace({ path: workspaceRoot, migrateV1: false }))
  expect(result.ok).toBe(true)
  process.chdir(workspaceRoot)
  return workspaceRoot
}

const writeHook = async (root: string, value: unknown): Promise<void> => {
  await writeFile(join(root, ".logbook/hooks/test.json"), JSON.stringify(value, null, 2))
}

afterEach(async () => {
  process.chdir(originalCwd)
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("runHook", () => {
  test("executes argv commands and captures stdout and stderr", async () => {
    const root = await makeWorkspace()
    await writeHook(root, {
      id: "echo",
      enabled: true,
      event: "task.status_changed",
      command: ["bun", "-e", "console.log('out'); console.error('err')"],
    })

    const result = await runHook({ hookId: "echo", event: "task.status_changed" })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data).toMatchObject({
      hookId: "echo",
      event: "task.status_changed",
      exitCode: 0,
      timedOut: false,
      stdout: "out\n",
      stderr: "err\n",
    })
    expect(Date.parse(result.data.startedAt)).not.toBeNaN()
    expect(Date.parse(result.data.finishedAt)).not.toBeNaN()
  })

  test("dryRun returns an envelope without executing the command", async () => {
    const root = await makeWorkspace()
    await writeHook(root, {
      id: "dry",
      enabled: true,
      event: "task.status_changed",
      command: ["bun", "-e", "await Bun.write('created-by-hook', 'no')"],
    })

    const result = await runHook({ hookId: "dry", event: "task.status_changed", dryRun: true })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data.exitCode).toBe(0)
    expect(result.data.warnings).toEqual([
      {
        code: "hook_dry_run",
        message: "Hook command was validated but not executed.",
      },
    ])
    expect(await Bun.file(join(root, "created-by-hook")).exists()).toBe(false)
  })

  test("returns timedOut true instead of throwing on timeout", async () => {
    const root = await makeWorkspace()
    await writeHook(root, {
      id: "slow",
      enabled: true,
      event: "task.status_changed",
      timeoutMs: 50,
      command: ["bun", "-e", "await Bun.sleep(1000)"],
    })

    const result = await runHook({ hookId: "slow", event: "task.status_changed" })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data.timedOut).toBe(true)
    expect(result.data.exitCode).toBeUndefined()
    expect(result.data.warnings?.some((warning) => warning.code === "hook_timeout")).toBe(true)
  })

  test("truncates stdout to configured bounds and warns", async () => {
    const root = await makeWorkspace()
    await writeFile(
      join(root, ".logbook/config.json"),
      JSON.stringify({
        schemaVersion: "2",
        storage: { root: ".logbook/storage" },
        hooks: {
          enabled: true,
          directory: ".logbook/hooks",
          defaultTimeoutMs: 5000,
          stdoutBytes: 4,
          stderrBytes: 1048576,
        },
      })
    )
    await writeHook(root, {
      id: "loud",
      enabled: true,
      event: "task.status_changed",
      command: ["bun", "-e", "process.stdout.write('abcdef')"],
    })

    const result = await runHook({ hookId: "loud", event: "task.status_changed" })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data.stdout).toBe("abcd")
    expect(result.data.warnings?.some((warning) => warning.code === "hook_output_truncated")).toBe(
      true
    )
  })

  test("rejects an invalid target hook with validation_error", async () => {
    const root = await makeWorkspace()
    await writeHook(root, {
      id: "bad",
      enabled: true,
      event: "task.status_changed",
      command: "echo unsafe",
    })

    const listed = await listHooks()
    expect(listed.ok).toBe(true)

    const result = await runHook({ hookId: "bad", event: "task.status_changed" })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
  })
})
