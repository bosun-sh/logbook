import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listHooks } from "@logbook/hook/list.js"
import { initWorkspace } from "@logbook/workspace/init.js"
import { Effect } from "effect"

let workspaceRoot: string | undefined
const originalCwd = process.cwd()

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E, never>)

const makeWorkspace = async (): Promise<string> => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-hooks-schema-"))
  const result = await run(initWorkspace({ path: workspaceRoot, migrateV1: false }))
  expect(result.ok).toBe(true)
  return workspaceRoot
}

const writeHook = async (root: string, name: string, value: unknown): Promise<void> => {
  await writeFile(join(root, ".logbook/hooks", name), JSON.stringify(value, null, 2))
}

afterEach(async () => {
  process.chdir(originalCwd)
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("v2 hook config loading", () => {
  test("loads valid JSON hook configs into public HookInfo records", async () => {
    const root = await makeWorkspace()
    process.chdir(root)
    await writeHook(root, "notify.json", {
      id: "notify",
      enabled: true,
      event: "task.status_changed",
      timeoutMs: 2500,
      command: ["bun", "--version"],
    })

    const result = await listHooks({ event: "task.status_changed" })

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "notify",
            event: "task.status_changed",
            command: "bun --version",
            enabled: true,
            timeoutMs: 2500,
          },
        ],
        hasMore: false,
      },
    })
  })

  test("surfaces invalid shell string commands, oversized argv, and outside cwd as warnings", async () => {
    const root = await makeWorkspace()
    process.chdir(root)
    await writeHook(root, "shell.json", {
      id: "shell",
      enabled: true,
      event: "task.status_changed",
      command: "echo no",
    })
    await writeHook(root, "argv.json", {
      id: "argv",
      enabled: true,
      event: "task.status_changed",
      command: Array.from({ length: 65 }, (_, index) => `arg${index}`),
    })
    await writeHook(root, "cwd.json", {
      id: "cwd",
      enabled: true,
      event: "task.status_changed",
      command: ["bun", "--version"],
      cwd: "..",
    })

    const result = await listHooks()

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data.items).toEqual([])
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "hook_config_invalid",
      "hook_config_invalid",
      "hook_config_invalid",
    ])
  })

  test("stops scanning at 200 JSON hook files and reports continuation", async () => {
    const root = await makeWorkspace()
    process.chdir(root)
    await mkdir(join(root, ".logbook/hooks"), { recursive: true })
    for (let index = 0; index < 201; index += 1) {
      await writeHook(root, `${String(index).padStart(3, "0")}.json`, {
        id: `hook-${String(index).padStart(3, "0")}`,
        enabled: true,
        event: "task.status_changed",
        command: ["bun", "--version"],
      })
    }

    const result = await listHooks({ limit: 250 })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.data.items).toHaveLength(100)
    expect(result.data.hasMore).toBe(true)
    expect(result.warnings?.some((warning) => warning.code === "has_more")).toBe(true)
  })
})
