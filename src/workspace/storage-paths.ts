export const StoragePaths = {
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
} as const

export type StoragePathName = keyof typeof StoragePaths
