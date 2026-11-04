import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { discoverBoards } from "@logbook/board/discover.js"

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

const board = async (dir: string) => {
  await mkdir(join(dir, ".logbook/storage"), { recursive: true })
  await writeFile(join(dir, ".logbook/storage/tasks.jsonl"), "")
}

test("finds root and nested boards, skips ignored dirs", async () => {
  root = await mkdtemp(join(tmpdir(), "board-discover-"))
  await board(root)
  await board(join(root, "org/repo/main"))
  for (const d of ["node_modules", ".git", ".bare", "dist"]) await board(join(root, "org", d, "x"))
  const labels = (await discoverBoards(root)).map((b) => b.label)
  expect(labels).toEqual([basename(root), "org/repo/main"].sort((a, b) => a.localeCompare(b)))
})

test("respects the depth bound", async () => {
  root = await mkdtemp(join(tmpdir(), "board-depth-"))
  await board(join(root, "a/b/c"))
  expect(await discoverBoards(root, 2)).toEqual([])
  expect((await discoverBoards(root, 3)).map((b) => b.label)).toEqual(["a/b/c"])
})
