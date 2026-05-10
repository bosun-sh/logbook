import { describe, expect, test } from "bun:test"
import {
  ensureStorageLayout,
  resolveWorkspacePaths,
  StoragePaths,
} from "@logbook/workspace/storage-layout.js"

describe("storage layout", () => {
  test("exposes the canonical relative storage paths", () => {
    expect(StoragePaths).toEqual({
      root: ".logbook",
      config: ".logbook/config.json",
      metadata: ".logbook/workspace.json",
      storageRoot: ".logbook/storage",
      hooksRoot: ".logbook/hooks/",
      epics: ".logbook/storage/epics.jsonl",
      stories: ".logbook/storage/stories.jsonl",
      tasks: ".logbook/storage/tasks.jsonl",
      contextEntries: ".logbook/storage/context-entries.jsonl",
      externalLinks: ".logbook/storage/external-links.jsonl",
      syncEvents: ".logbook/storage/sync-events.jsonl",
      syncConflicts: ".logbook/storage/sync-conflicts.jsonl",
    })
  })

  test("resolves the canonical workspace layout without touching the filesystem", () => {
    const layout = resolveWorkspacePaths("/repo/project")

    expect(layout).toEqual({
      workspaceRoot: "/repo/project",
      logbookRoot: "/repo/project/.logbook",
      config: "/repo/project/.logbook/config.json",
      metadata: "/repo/project/.logbook/workspace.json",
      storageRoot: "/repo/project/.logbook/storage",
      hooksRoot: "/repo/project/.logbook/hooks/",
      epics: "/repo/project/.logbook/storage/epics.jsonl",
      stories: "/repo/project/.logbook/storage/stories.jsonl",
      tasks: "/repo/project/.logbook/storage/tasks.jsonl",
      contextEntries: "/repo/project/.logbook/storage/context-entries.jsonl",
      externalLinks: "/repo/project/.logbook/storage/external-links.jsonl",
      syncEvents: "/repo/project/.logbook/storage/sync-events.jsonl",
      syncConflicts: "/repo/project/.logbook/storage/sync-conflicts.jsonl",
    })
  })

  test("rejects workspace roots that push any canonical path over the byte limit", () => {
    const workspaceRoot = `/${"a".repeat(4100)}`

    expect(() => resolveWorkspacePaths(workspaceRoot)).toThrow()
  })

  test("ensures an already resolved layout matches the canonical path table", () => {
    const layout = resolveWorkspacePaths("/repo/project")

    expect(ensureStorageLayout(layout)).toEqual(layout)
  })

  test("rejects a resolved layout when a canonical path is changed", () => {
    const layout = resolveWorkspacePaths("/repo/project")
    const invalidLayout = {
      ...layout,
      config: "/repo/project/.logbook/configs.json",
    }

    expect(() => ensureStorageLayout(invalidLayout)).toThrow()
  })
})
