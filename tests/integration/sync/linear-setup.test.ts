import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setupLinearSync } from "@logbook/sync/linear/setup.js"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import { Context, Effect, Layer } from "effect"

const LinearGraphQLClientTag =
  Context.GenericTag<ReturnType<typeof LinearTransport.fixture>>("LinearGraphQLClient")

let workspaceRoot: string | undefined
const originalCwd = process.cwd()

const makeWorkspace = async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-linear-setup-"))
  await mkdir(join(workspaceRoot, ".logbook"), { recursive: true })
  await writeFile(
    join(workspaceRoot, ".logbook/config.json"),
    JSON.stringify(
      {
        schemaVersion: "2",
        storage: { root: ".logbook/storage" },
        hooks: {
          enabled: true,
          directory: ".logbook/hooks",
          defaultTimeoutMs: 5000,
          stdoutBytes: 1048576,
          stderrBytes: 1048576,
        },
      },
      null,
      2
    ),
    "utf8"
  )
  process.chdir(workspaceRoot)
  return workspaceRoot
}

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"))

afterEach(async () => {
  process.chdir(originalCwd)
  delete process.env.LINEAR_API_KEY
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = undefined
  }
})

describe("Linear setup sync", () => {
  test("writes manual workspace and team ids without storing an API key in config", async () => {
    const root = await makeWorkspace()

    const result = await Effect.runPromise(
      setupLinearSync({
        workspaceId: "workspace_1",
        teamId: "team_1",
        projectId: "project_1",
        apiToken: "lin_api_test",
        writeEnv: true,
      }) as Effect.Effect<unknown, never, never>
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        apiTokenEnv: "LINEAR_API_KEY",
        workspaceId: "workspace_1",
        defaultTeamId: "team_1",
        defaultProjectId: "project_1",
        dotenv: { created: true },
      },
    })
    await expect(readJson(join(root, ".logbook/config.json"))).resolves.toMatchObject({
      linear: {
        apiTokenEnv: "LINEAR_API_KEY",
        workspaceId: "workspace_1",
        defaultTeamId: "team_1",
        defaultProjectId: "project_1",
      },
    })
    await expect(readFile(join(root, ".env"), "utf8")).resolves.toBe(
      "LINEAR_API_KEY=lin_api_test\n"
    )
    expect(JSON.stringify(await readJson(join(root, ".logbook/config.json")))).not.toContain(
      "lin_api_test"
    )
  })

  test("resolves workspace and team ids from a Linear team URL", async () => {
    const root = await makeWorkspace()
    process.env.LINEAR_API_KEY = "token"
    const client = LinearTransport.fixture([
      {
        name: "resolve",
        request: { operationName: "LinearResolveSetup", variables: { teamKey: "BOSUN" } },
        response: {
          status: 200,
          body: {
            data: {
              organization: { id: "workspace_bosun", urlKey: "bosun" },
              teams: { nodes: [{ id: "team_bosun", key: "BOSUN", name: "bosun" }] },
            },
          },
        },
      },
    ])

    const result = await Effect.runPromise(
      Effect.provide(
        setupLinearSync({ teamUrl: "https://linear.app/bosun/team/BOSUN" }),
        Layer.succeed(LinearGraphQLClientTag, client)
      ) as Effect.Effect<unknown, never>
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        workspaceId: "workspace_bosun",
        defaultTeamId: "team_bosun",
        resolvedFromUrl: true,
      },
    })
    await expect(readJson(join(root, ".logbook/config.json"))).resolves.toMatchObject({
      linear: {
        workspaceId: "workspace_bosun",
        defaultTeamId: "team_bosun",
      },
    })
  })
})
