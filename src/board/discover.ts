import { readdir, stat } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"

const SKIP = new Set(["node_modules", ".git", ".bare", "dist", ".logbook"])

export type DiscoveredBoard = { readonly label: string; readonly root: string }

const isBoard = async (dir: string): Promise<boolean> =>
  stat(join(dir, ".logbook", "storage", "tasks.jsonl")).then(
    (s) => s.isFile(),
    () => false
  )

export const discoverBoards = async (root: string, maxDepth = 6): Promise<DiscoveredBoard[]> => {
  const base = resolve(root)
  const boards: DiscoveredBoard[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number }
    if (await isBoard(dir)) {
      boards.push({
        label: dir === base ? basename(base) : relative(base, dir).split("\\").join("/"),
        root: dir,
      })
    }
    if (depth >= maxDepth) continue
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP.has(entry.name)) {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
      }
    }
  }
  return boards.sort((a, b) => a.label.localeCompare(b.label))
}
