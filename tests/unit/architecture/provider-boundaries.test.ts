import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { compareBaseLocalRemote } from "@logbook/sync/base-snapshot.js"
import { deferredProviderNotes } from "@logbook/sync/deferred-providers.js"
import {
  classifySyncRetry,
  DEFAULT_PROVIDER_RETRY_ATTEMPTS,
  type SyncProviderError,
  type SyncProviderPort,
} from "@logbook/sync/provider-port.js"
import { registerSyncProvider, SyncProviderRegistry } from "@logbook/sync/provider-registry.js"
import { Effect } from "effect"

const SYNC_ROOT = join(process.cwd(), "src/sync")
const LINEAR_IMPORT_PATTERN =
  /from\s+['"][^'"]*(?:@logbook\/sync\/linear|\/linear\/|\.\/linear\/|\.\.\/linear\/)[^'"]*['"]/

describe("architecture / sync provider boundaries", () => {
  test("defines a provider-independent pull, push, status, cursor, and retry port", async () => {
    const provider: SyncProviderPort = {
      providerId: "example-provider",
      pull: (input) =>
        Effect.succeed({
          imported: input.dryRun ? 0 : 1,
          updated: 0,
          skipped: 0,
          conflicts: 0,
          events: [],
          nextCursor: {
            providerId: "example-provider",
            cursor: "next-page",
            pageSize: input.limit ?? 100,
          },
        }),
      push: () =>
        Effect.succeed({
          created: 0,
          updated: 1,
          skipped: 0,
          conflicts: 0,
          events: [],
        }),
      status: (input) =>
        Effect.succeed({
          providerId: "example-provider",
          configured: true,
          reachable: input.checkProvider,
          authenticated: input.checkProvider,
          pendingConflicts: 0,
        }),
      classifyRetry: classifySyncRetry,
    }

    const pullResult = await Effect.runPromise(
      provider.pull({
        limit: 50,
        cursor: { providerId: "example-provider", cursor: "page-1", pageSize: 50 },
        dryRun: true,
      })
    )
    const pushResult = await Effect.runPromise(provider.push({ dryRun: false }))
    const statusResult = await Effect.runPromise(provider.status({ checkProvider: true }))

    expect(provider.providerId).toBe("example-provider")
    expect(pullResult.nextCursor).toEqual({
      providerId: "example-provider",
      cursor: "next-page",
      pageSize: 50,
    })
    expect(pushResult.updated).toBe(1)
    expect(statusResult).toMatchObject({
      providerId: "example-provider",
      configured: true,
      reachable: true,
      authenticated: true,
    })
  })

  test("classifies bounded retryable transport errors without provider-specific types", () => {
    const rateLimit: SyncProviderError = {
      providerId: "example-provider",
      code: "rate_limited",
      retryable: true,
      message: "try later",
      details: { retryAfterMs: 750 },
    }
    const authFailure: SyncProviderError = {
      providerId: "example-provider",
      code: "auth_failed",
      retryable: true,
      message: "bad token",
    }

    expect(classifySyncRetry(rateLimit)).toEqual({
      retryable: true,
      retryAfterMs: 750,
      maxAttempts: DEFAULT_PROVIDER_RETRY_ATTEMPTS,
    })
    expect(classifySyncRetry(authFailure)).toEqual({ retryable: false })
  })

  test("compares base, local, and remote fields before provider mutations", () => {
    const acceptedRemote = compareBaseLocalRemote({
      externalLink: {
        lastSeenRemoteVersion: "remote-v1",
        lastPushedLocalVersion: "local-v1",
      },
      base: {
        remoteVersion: "remote-v1",
        localVersion: "local-v1",
        fields: { title: "Original", priority: 1 },
      },
      local: {
        version: "local-v1",
        fields: { title: "Original", priority: 2 },
      },
      remote: {
        version: "remote-v2",
        fields: { title: "Remote title", priority: 1 },
      },
      fieldPaths: ["title", "priority"],
    })

    expect(acceptedRemote).toEqual({
      ok: true,
      data: {
        action: "merge",
        fields: ["title", "priority"],
        fieldDecisions: [
          { action: "accept_remote", path: "title" },
          { action: "keep_local", path: "priority" },
        ],
      },
    })

    const conflict = compareBaseLocalRemote({
      externalLink: {
        lastSeenRemoteVersion: "remote-v1",
        lastPushedLocalVersion: "local-v1",
      },
      base: {
        remoteVersion: "remote-v1",
        localVersion: "local-v1",
        fields: { title: "Original" },
      },
      local: {
        version: "local-v2",
        fields: { title: "Local title" },
      },
      remote: {
        version: "remote-v2",
        fields: { title: "Remote title" },
      },
      fieldPaths: ["title"],
    })

    expect(conflict).toEqual({
      ok: true,
      data: {
        action: "conflict",
        fields: ["title"],
        fieldDecisions: [{ action: "conflict", path: "title" }],
      },
    })
  })

  test("documents GitHub as deferred from v2 and points future work at provider ports", () => {
    expect(deferredProviderNotes).toEqual([
      "GitHub sync is deferred from v2.",
      "Future GitHub work should use the sync provider port and static plugin registration.",
      "Do not add sync.github.* tools or require workspace GitHub credentials in v2.",
    ])
  })

  test("rejects stale base snapshots instead of allowing unsafe provider mutation", () => {
    const result = compareBaseLocalRemote({
      externalLink: {
        lastSeenRemoteVersion: "remote-v2",
        lastPushedLocalVersion: "local-v1",
      },
      base: {
        remoteVersion: "remote-v1",
        localVersion: "local-v1",
        fields: { title: "Original" },
      },
      local: {
        version: "local-v1",
        fields: { title: "Original" },
      },
      remote: {
        version: "remote-v2",
        fields: { title: "Remote title" },
      },
      fieldPaths: ["title"],
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "sync_conflict",
      },
    })
  })

  test("keeps provider config namespaced under the provider key and warns on slow health checks", () => {
    const registry = registerSyncProvider(new SyncProviderRegistry(), {
      provider: "linear",
      config: {
        apiTokenEnv: "LINEAR_API_KEY",
        workspaceId: "workspace_1",
      },
    })

    expect(registry.snapshot()).toEqual({
      config: {
        linear: {
          apiTokenEnv: "LINEAR_API_KEY",
          workspaceId: "workspace_1",
        },
      },
      providers: [
        {
          provider: "linear",
          config: {
            apiTokenEnv: "LINEAR_API_KEY",
            workspaceId: "workspace_1",
          },
          healthTimeoutMs: 5000,
        },
      ],
    })
    expect(registry.healthTimeoutWarning("linear", 4999)).toBeUndefined()
    expect(registry.healthTimeoutWarning("linear", 5000)).toEqual({
      code: "provider_warning",
      message: "Provider health check exceeded the timeout.",
      details: {
        provider: "linear",
        elapsedMs: 5000,
        timeoutMs: 5000,
      },
    })
  })

  test("provider foundation modules do not import Linear implementation modules", () => {
    for (const file of walkSyncFoundationFiles(SYNC_ROOT)) {
      const content = readFileSync(file, "utf8")
      expect(LINEAR_IMPORT_PATTERN.test(content)).toBeFalse()
    }
  })
})

const walkSyncFoundationFiles = (root: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!fullPath.endsWith("/linear")) {
        files.push(...walkSyncFoundationFiles(fullPath))
      }
      continue
    }

    if (entry.name.endsWith(".ts")) {
      files.push(fullPath)
    }
  }

  return files.filter((file) => !file.includes("/src/sync/linear/"))
}
