import { describe, expect, test } from "bun:test"
import { deferredProviderNotes } from "@logbook/sync/deferred-providers.js"
import { registerSyncProvider, SyncProviderRegistry } from "@logbook/sync/provider-registry.js"

const makeRegistry = (count: number): SyncProviderRegistry => {
  let registry = new SyncProviderRegistry()
  for (let index = 0; index < count; index += 1) {
    registry = registerSyncProvider(registry, {
      provider: `provider_${String(index + 1).padStart(2, "0")}`,
      config: {
        id: index + 1,
      },
    })
  }

  return registry
}

const expectRegistryError = (callback: () => unknown, code: string) => {
  try {
    callback()
    throw new Error("expected registry registration to fail")
  } catch (cause) {
    expect(cause).toMatchObject({ code })
  }
}

describe("provider plugin registration", () => {
  test("registers provider configs statically and namespaces config under the provider key", () => {
    const registry = registerSyncProvider(new SyncProviderRegistry(), {
      provider: "linear",
      config: {
        apiTokenEnv: "LINEAR_API_KEY",
        workspaceId: "workspace_1",
      },
    })

    expect(registry.list()).toEqual([
      {
        provider: "linear",
        config: {
          apiTokenEnv: "LINEAR_API_KEY",
          workspaceId: "workspace_1",
        },
        healthTimeoutMs: 5000,
      },
    ])
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
  })

  test("returns a provider warning when the health check reaches the timeout bound", () => {
    const registry = registerSyncProvider(new SyncProviderRegistry(), {
      provider: "linear",
      config: {},
      healthTimeoutMs: 5000,
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

  test("rejects provider config JSON above 65536 bytes with validation_error", () => {
    expectRegistryError(
      () =>
        registerSyncProvider(new SyncProviderRegistry(), {
          provider: "linear",
          config: {
            payload: "x".repeat(65_537),
          },
        }),
      "validation_error"
    )
  })

  test("rejects more than 10 statically registered provider plugins with tool_registration_error", () => {
    const registry = makeRegistry(10)

    expect(registry.list()).toHaveLength(10)
    expectRegistryError(
      () =>
        registerSyncProvider(registry, {
          provider: "provider_11",
          config: {},
        }),
      "tool_registration_error"
    )
  })

  test("keeps deferred GitHub guidance prose-only with provider ports and static registration", () => {
    const registry = registerSyncProvider(new SyncProviderRegistry(), {
      provider: "linear",
      config: {
        apiTokenEnv: "LINEAR_API_KEY",
        workspaceId: "workspace_1",
      },
    })

    expect(deferredProviderNotes).toContain(
      "Future GitHub work should use the sync provider port and static plugin registration."
    )
    expect(deferredProviderNotes).toContain(
      "Do not add sync.github.* tools or require workspace GitHub credentials in v2."
    )
    expect(registry.list().some((provider) => provider.provider.startsWith("sync.github."))).toBe(
      false
    )
  })
})
