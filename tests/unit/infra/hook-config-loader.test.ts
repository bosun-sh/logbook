import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadHookConfigs } from "@logbook/infra/hook-config-loader.js"

const makeTempDir = () => mkdtemp(join(tmpdir(), "logbook-hook-test-"))

let dirs: string[] = []

const newTempDir = async () => {
  const dir = await makeTempDir()
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe("loadHookConfigs / missing hooksDir", () => {
  test("returns [] when hooksDir does not exist (ENOENT)", async () => {
    const nonExistent = join(tmpdir(), "logbook-hook-no-such-dir-99999")
    const result = await loadHookConfigs(nonExistent)
    expect(result).toEqual([])
  })
})

describe("loadHookConfigs / valid hook with script.ts", () => {
  test("parses config.yml and returns correct HookConfig", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "notify_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `event: task.status_changed\ncondition: "new_status == 'need_info'"\ntimeout_ms: 3000\n`
    )
    await writeFile(join(hookDir, "script.ts"), `console.log("hello")`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    const config = result[0]
    expect(config?.event).toBe("task.status_changed")
    expect(config?.condition).toBe("new_status == 'need_info'")
    expect(config?.timeout_ms).toBe(3000)
    expect(config?.script).toContain("script.ts")
  })
})

describe("loadHookConfigs / valid hook without optional fields", () => {
  test("returns config without condition and timeout_ms when absent", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "simple_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "config.yml"), `event: task.status_changed\n`)
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    const config = result[0]
    expect(config?.event).toBe("task.status_changed")
    expect(config?.condition).toBeUndefined()
    expect(config?.timeout_ms).toBeUndefined()
  })
})

describe("loadHookConfigs / script.sh fallback", () => {
  test("discovers script.sh when script.ts is absent", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "shell_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "config.yml"), `event: task.status_changed\n`)
    await writeFile(join(hookDir, "script.sh"), `echo "running"`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    expect(result[0]?.script).toContain("script.sh")
  })
})

describe("loadHookConfigs / skips invalid entries", () => {
  test("skips hook entry if config.yml is missing", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "no_config_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "script.ts"), `// no config`)

    const result = await loadHookConfigs(hooksDir)
    expect(result).toEqual([])
  })

  test("skips hook entry if config.yml is invalid YAML structure", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "bad_config_hook")
    await mkdir(hookDir)
    // 'event' field is required by schema; an empty file will fail validation
    await writeFile(join(hookDir, "config.yml"), `# no fields here\n`)
    await writeFile(join(hookDir, "script.ts"), `// script`)

    const result = await loadHookConfigs(hooksDir)
    expect(result).toEqual([])
  })

  test("skips hook entry if neither script.ts nor script.sh exists", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "no_script_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "config.yml"), `event: task.status_changed\n`)

    const result = await loadHookConfigs(hooksDir)
    expect(result).toEqual([])
  })
})

describe("loadHookConfigs / multiple hooks", () => {
  test("loads all valid hooks and skips invalid ones", async () => {
    const hooksDir = await newTempDir()

    const good1 = join(hooksDir, "hook_a")
    await mkdir(good1)
    await writeFile(join(good1, "config.yml"), `event: task.status_changed\n`)
    await writeFile(join(good1, "script.ts"), `// a`)

    const good2 = join(hooksDir, "hook_b")
    await mkdir(good2)
    await writeFile(join(good2, "config.yml"), `event: task.status_changed\n`)
    await writeFile(join(good2, "script.sh"), `echo "b"`)

    const bad = join(hooksDir, "hook_c")
    await mkdir(bad)
    // no config.yml, no script

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(2)
  })
})

describe("loadHookConfigs / unrecognized keys warning", () => {
  test("emits warning for unrecognized key but still loads the hook", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "unrecognized_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `event: task.status_changed\nunknown_field: some_value\n`
    )
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const stderrLines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: unknown, ..._rest: unknown[]): boolean => {
      stderrLines.push(String(chunk))
      return true
    }

    try {
      const result = await loadHookConfigs(hooksDir)
      expect(result.length).toBe(1)
      expect(result[0]?.event).toBe("task.status_changed")
      // Should have warned about the unrecognized key
      const warnings = stderrLines.filter((w) => w.includes("unrecognized key"))
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain("unrecognized_hook")
      expect(warnings[0]).toContain("unknown_field")
      expect(warnings[0]).toContain("event")
      expect(warnings[0]).toContain("condition")
      expect(warnings[0]).toContain("timeout_ms")
    } finally {
      process.stderr.write = originalWrite
    }
  })

  test("does not warn when all keys are recognized", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "valid_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `event: task.status_changed\ncondition: "test"\ntimeout_ms: 5000\n`
    )
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const stderrLines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: unknown, ..._rest: unknown[]): boolean => {
      stderrLines.push(String(chunk))
      return true
    }

    try {
      const result = await loadHookConfigs(hooksDir)
      expect(result.length).toBe(1)
      // Should have no unrecognized key warnings
      const warnings = stderrLines.filter((w) => w.includes("unrecognized key"))
      expect(warnings.length).toBe(0)
    } finally {
      process.stderr.write = originalWrite
    }
  })

  test("warns on multiple unrecognized keys", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "multi_unrecognized_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `event: task.status_changed\ntypo_field: value\nanother_typo: 123\n`
    )
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const stderrLines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: unknown, ..._rest: unknown[]): boolean => {
      stderrLines.push(String(chunk))
      return true
    }

    try {
      const result = await loadHookConfigs(hooksDir)
      expect(result.length).toBe(1)
      // Should have warned about both unrecognized keys
      const warnings = stderrLines.filter((w) => w.includes("unrecognized key"))
      expect(warnings.length).toBe(2)
      expect(warnings.some((w) => w.includes("typo_field"))).toBe(true)
      expect(warnings.some((w) => w.includes("another_typo"))).toBe(true)
    } finally {
      process.stderr.write = originalWrite
    }
  })
})

describe("parseSimpleYaml behavior (via loadHookConfigs)", () => {
  test("handles single-quoted string values", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "sq_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "config.yml"), `event: 'task.status_changed'\n`)
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    expect(result[0]?.event).toBe("task.status_changed")
  })

  test("handles bare integer values (timeout_ms)", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "int_hook")
    await mkdir(hookDir)
    await writeFile(join(hookDir, "config.yml"), `event: task.status_changed\ntimeout_ms: 7500\n`)
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    expect(result[0]?.timeout_ms).toBe(7500)
  })

  test("ignores comment lines and blank lines", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "comments_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `# This is a comment\n\nevent: task.status_changed\n\n# another comment\n`
    )
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    expect(result[0]?.event).toBe("task.status_changed")
  })

  test("handles double-quoted string values", async () => {
    const hooksDir = await newTempDir()
    const hookDir = join(hooksDir, "dq_hook")
    await mkdir(hookDir)
    await writeFile(
      join(hookDir, "config.yml"),
      `event: task.status_changed\ncondition: "new_status == 'done'"\n`
    )
    await writeFile(join(hookDir, "script.ts"), `// noop`)

    const result = await loadHookConfigs(hooksDir)
    expect(result.length).toBe(1)
    expect(result[0]?.condition).toBe("new_status == 'done'")
  })
})
