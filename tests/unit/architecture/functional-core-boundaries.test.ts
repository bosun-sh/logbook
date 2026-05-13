import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const SRC_DIR = join(process.cwd(), "src")
const MAX_FILES_SCANNED = 10_000
const MAX_FILE_BYTES = 1_048_576

const CORE_DOMAIN_DIRS = [
  join(SRC_DIR, "epic"),
  join(SRC_DIR, "story"),
  join(SRC_DIR, "context"),
  join(SRC_DIR, "task"),
  join(SRC_DIR, "sync"),
]

const FORBIDDEN_IMPORT_PATTERNS = [
  "@bosun-sh/ohtools",
  "/cli/",
  "/mcp/",
  "/infra/",
  "node:net",
  "node:http",
  "node:https",
]

const isPluginBridgeFile = (name: string): boolean =>
  name.endsWith("-tools.ts") || name === "conflict-tools.ts"

const walkTsFiles = (root: string): string[] => {
  const files: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const next = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(next)
      } else if (entry.isFile() && next.endsWith(".ts") && !isPluginBridgeFile(entry.name)) {
        files.push(next)
        if (files.length > MAX_FILES_SCANNED) {
          throw new Error("architecture_violation: file scan bound exceeded")
        }
      }
    }
  }

  return files
}

describe("architecture / functional core boundaries", () => {
  test("entity domain modules do not import adapters, ohtools, or http clients", () => {
    const files = CORE_DOMAIN_DIRS.flatMap(walkTsFiles)
    for (const file of files) {
      const size = statSync(file).size
      expect(size).toBeLessThanOrEqual(MAX_FILE_BYTES)
      const content = readFileSync(file, "utf8")
      for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
        expect(content.includes(forbidden)).toBeFalse()
      }
    }
  })
})
