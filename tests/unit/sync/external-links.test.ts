import { beforeEach, describe, expect, test } from "bun:test"
import type { ExternalLink } from "@logbook/context/schema.js"
import {
  findExternalLink,
  updateExternalLinkSnapshot,
  upsertExternalLink,
} from "@logbook/sync/external-links.js"
import { Clock, Context, Effect, Layer } from "effect"

type ExternalLinkRepositoryShape = {
  create(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
  get(id: string): Effect.Effect<ExternalLink, unknown>
  list(): Effect.Effect<readonly ExternalLink[], unknown>
  update(link: ExternalLink): Effect.Effect<ExternalLink, unknown>
}

class InMemoryExternalLinkRepository implements ExternalLinkRepositoryShape {
  private readonly store = new Map<string, ExternalLink>()

  constructor(initialLinks: readonly ExternalLink[] = []) {
    for (const link of initialLinks) {
      this.store.set(link.id, link)
    }
  }

  create(link: ExternalLink) {
    if (
      [...this.store.values()].some(
        (record) => record.id === link.id && record.deletedAt === undefined
      )
    ) {
      return Effect.fail({
        _tag: "conflict",
        message: `external link ${link.id} already exists`,
        id: link.id,
      })
    }

    this.store.set(link.id, link)
    return Effect.succeed(link)
  }

  get(id: string) {
    const link = this.store.get(id)
    if (link === undefined || link.deletedAt !== undefined) {
      return Effect.fail({ _tag: "not_found", message: `external link ${id} was not found`, id })
    }

    return Effect.succeed(link)
  }

  list() {
    return Effect.succeed([...this.store.values()].filter((link) => link.deletedAt === undefined))
  }

  update(link: ExternalLink) {
    if (!this.store.has(link.id) || this.store.get(link.id)?.deletedAt !== undefined) {
      return Effect.fail({
        _tag: "not_found",
        message: `external link ${link.id} was not found`,
        id: link.id,
      })
    }

    this.store.set(link.id, link)
    return Effect.succeed(link)
  }

  inspectAll() {
    return [...this.store.values()].filter((link) => link.deletedAt === undefined)
  }
}

const ExternalLinkRepositoryTag =
  Context.GenericTag<ExternalLinkRepositoryShape>("ExternalLinkRepository")

const fixedClock = {
  [Clock.ClockTypeId]: Clock.ClockTypeId,
  unsafeCurrentTimeMillis: () => Date.parse("2026-01-02T12:34:56.789Z"),
  currentTimeMillis: Effect.succeed(Date.parse("2026-01-02T12:34:56.789Z")),
  unsafeCurrentTimeNanos: () => 1_769_273_696_789_000_000n,
  currentTimeNanos: Effect.succeed(1_769_273_696_789_000_000n),
  sleep: () => Effect.succeed(undefined),
} satisfies Clock.Clock

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const runWithRepo = <A>(
  effect: Effect.Effect<A, unknown, ExternalLinkRepositoryShape | Clock.Clock>
) =>
  run(
    Effect.provide(
      Effect.withClock(fixedClock)(effect),
      Layer.succeed(ExternalLinkRepositoryTag, repo)
    )
  )

const makeLink = (overrides: Partial<ExternalLink> = {}): ExternalLink => ({
  id: "external_link_00000000000000000000000000000001",
  schemaVersion: "2",
  kind: "external_link",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provider: "linear",
  localRecord: {
    kind: "task",
    id: "task_1",
  },
  remoteRecord: {
    id: "LIN-123",
    url: "https://linear.app/example/issue/LIN-123",
    type: "issue",
  },
  ...overrides,
})

let repo: InMemoryExternalLinkRepository

beforeEach(() => {
  repo = new InMemoryExternalLinkRepository()
})

describe("external link use cases", () => {
  test("creates a valid link preserving provider, local, remote fields and metadata", async () => {
    const result = await runWithRepo(
      upsertExternalLink({
        provider: "linear",
        localRecord: { kind: "task", id: "task_1" },
        remoteRecord: {
          id: "LIN-123",
          url: "https://linear.app/example/issue/LIN-123",
          type: "issue",
        },
        lastSeenRemoteVersion: "remote-v1",
        lastPushedLocalVersion: "local-v1",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected upsertExternalLink to succeed")
    }

    expect(result.data.created).toBe(true)
    expect(result.data.externalLink).toMatchObject({
      schemaVersion: "2",
      kind: "external_link",
      provider: "linear",
      localRecord: { kind: "task", id: "task_1" },
      remoteRecord: {
        id: "LIN-123",
        url: "https://linear.app/example/issue/LIN-123",
        type: "issue",
      },
      createdAt: "2026-01-02T12:34:56.789Z",
      updatedAt: "2026-01-02T12:34:56.789Z",
      lastSyncedAt: "2026-01-02T12:34:56.789Z",
      lastSeenRemoteVersion: "remote-v1",
      lastPushedLocalVersion: "local-v1",
    })
    expect(result.data.externalLink.id.startsWith("external_link_")).toBe(true)
  })

  test("updates an existing active tuple snapshot instead of creating a duplicate", async () => {
    const existing = makeLink()
    repo = new InMemoryExternalLinkRepository([existing])

    const result = await runWithRepo(
      upsertExternalLink({
        provider: "linear",
        localRecord: existing.localRecord,
        remoteRecord: existing.remoteRecord,
        lastSeenRemoteVersion: "remote-v2",
        lastPushedLocalVersion: "local-v2",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected upsertExternalLink to update")
    }

    expect(result.data.created).toBe(false)
    expect(result.data.externalLink.id).toBe(existing.id)
    expect(result.data.externalLink.lastSeenRemoteVersion).toBe("remote-v2")
    expect(result.data.externalLink.lastPushedLocalVersion).toBe("local-v2")
    expect(result.data.externalLink.lastSyncedAt).toBe("2026-01-02T12:34:56.789Z")
    expect(result.data.externalLink.updatedAt).toBe("2026-01-02T12:34:56.789Z")
    expect(repo.inspectAll()).toHaveLength(1)
  })

  test("fails conflict when duplicate active links already exist for one tuple", async () => {
    const first = makeLink()
    const second = makeLink({
      id: "external_link_00000000000000000000000000000002",
    })
    repo = new InMemoryExternalLinkRepository([first, second])

    const result = await runWithRepo(
      upsertExternalLink({
        provider: "linear",
        localRecord: first.localRecord,
        remoteRecord: first.remoteRecord,
      })
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflict",
      },
    })
  })

  test("resolves a Linear remote issue id to a local task link", async () => {
    const existing = makeLink({
      localRecord: { kind: "task", id: "task_abc" },
      remoteRecord: { id: "LIN-123", type: "issue" },
    })
    repo = new InMemoryExternalLinkRepository([existing])

    const result = await runWithRepo(
      findExternalLink({
        provider: "linear",
        remoteRecordId: "LIN-123",
      })
    )

    expect(result).toEqual({
      ok: true,
      data: {
        externalLinks: [existing],
        hasMore: false,
      },
    })
  })

  test("updates snapshot fields and fails not_found for unknown ids", async () => {
    const existing = makeLink()
    repo = new InMemoryExternalLinkRepository([existing])

    const result = await runWithRepo(
      updateExternalLinkSnapshot({
        id: existing.id,
        lastSeenRemoteVersion: "remote-v3",
        lastPushedLocalVersion: "local-v3",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected updateExternalLinkSnapshot to succeed")
    }

    expect(result.data.externalLink).toMatchObject({
      id: existing.id,
      lastSeenRemoteVersion: "remote-v3",
      lastPushedLocalVersion: "local-v3",
      lastSyncedAt: "2026-01-02T12:34:56.789Z",
      updatedAt: "2026-01-02T12:34:56.789Z",
    })

    const missing = await runWithRepo(
      updateExternalLinkSnapshot({
        id: "external_link_missing",
        lastSeenRemoteVersion: "remote-v4",
      })
    )

    expect(missing).toMatchObject({
      ok: false,
      error: {
        code: "not_found",
      },
    })
  })

  test("list results are bounded to 500 links and return hasMore warning", async () => {
    repo = new InMemoryExternalLinkRepository(
      Array.from({ length: 501 }, (_, index) =>
        makeLink({
          id: `external_link_${index.toString().padStart(32, "0")}`,
          localRecord: { kind: "task", id: `task_${index}` },
          remoteRecord: { id: `LIN-${index}`, type: "issue" },
        })
      )
    )

    const result = await runWithRepo(
      findExternalLink({
        provider: "linear",
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected findExternalLink to succeed")
    }

    expect(result.data.externalLinks).toHaveLength(500)
    expect(result.data.hasMore).toBe(true)
    expect(result.warnings).toEqual([
      {
        code: "result_truncated",
        message: "External link list exceeded the 500 item limit.",
        details: {
          limit: 500,
          hasMore: true,
        },
      },
    ])
  })
})
