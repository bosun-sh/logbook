import { mkdtemp, writeFile, readFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface TempJsonl {
  path:    string
  write:   (lines: string[]) => Promise<void>
  read:    () => Promise<string[]>
  cleanup: () => Promise<void>
}

export const createTempJsonl = async (): Promise<TempJsonl> => {
  const dir  = await mkdtemp(join(tmpdir(), "logbook-e2e-"))
  const path = join(dir, "tasks.jsonl")

  // Create empty file
  await writeFile(path, "", "utf8")

  return {
    path,
    write:   (lines) => writeFile(path, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8"),
    read:    async () => {
      const content = await readFile(path, "utf8")
      return content.split("\n").filter(l => l.trim() !== "")
    },
    cleanup: () => unlink(path).catch(() => undefined),
  }
}
