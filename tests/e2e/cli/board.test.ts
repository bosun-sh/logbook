import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "@logbook/workspace/cli-adapter.js"

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

const rec = (id: string, status: string, extra: object = {}) => ({
  id,
  schemaVersion: "2",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  kind: "task",
  project: "p",
  milestone: "m",
  title: `Title ${id}`,
  description: "desc",
  definitionOfDone: "dod",
  status,
  priority: 1,
  phaseModelOverrides: {},
  estimate: { predictedKTokens: 1, complexity: "small", fibonacci: 1, confidence: "low" },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...extra,
})

const board = async (dir: string, lines: string[]) => {
  await mkdir(join(dir, ".logbook/storage"), { recursive: true })
  await writeFile(join(dir, ".logbook/storage/tasks.jsonl"), `${lines.join("\n")}\n`)
}

test("board renders good boards, drops tombstones, warns on corrupt boards", async () => {
  root = await mkdtemp(join(tmpdir(), "board-e2e-"))
  await board(join(root, "org/a"), [
    JSON.stringify(rec("a1", "need_info")),
    JSON.stringify(rec("a2", "done")),
    JSON.stringify(rec("a3", "todo", { deletedAt: "2026-01-02T00:00:00.000Z" })),
  ])
  await board(join(root, "org/b"), [JSON.stringify(rec("b1", "todo"))])
  await board(join(root, "org/bad"), ["{not json"])
  const out = join(root, "out/board.html")
  let stdout = ""
  await runCli(["board", "--root", root, "--out", out], {
    stdout: (c: string) => (stdout += c),
  } as never)
  const env = JSON.parse(stdout.trim())
  expect(env.ok).toBe(true)
  const a = env.data.boards.find((b: any) => b.label === "org/a")
  expect(a.total).toBe(2)
  expect(a.waiting).toBe(1)
  expect(env.data.boards.find((b: any) => b.label === "org/b").total).toBe(1)
  expect(env.warnings.some((w: any) => w.details?.label === "org/bad")).toBe(true)
  const html = await readFile(out, "utf8")
  expect(html).toContain("Title a1")
  expect(html).not.toContain("Title a3")
})
