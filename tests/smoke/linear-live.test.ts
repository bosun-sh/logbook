import { describe, expect, test } from "bun:test"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import { Effect } from "effect"

const liveSmokeEnabled =
  process.env.LOGBOOK_LINEAR_LIVE_SMOKE === "1" &&
  process.env.LINEAR_API_KEY !== undefined &&
  process.env.LOGBOOK_LINEAR_WORKSPACE_ID !== undefined &&
  process.env.LOGBOOK_LINEAR_TEAM_ID !== undefined

describe("Linear live smoke", () => {
  test("skips by default unless explicitly enabled with credentials and workspace config", () => {
    expect(liveSmokeEnabled).toBe(
      process.env.LOGBOOK_LINEAR_LIVE_SMOKE === "1" &&
        process.env.LINEAR_API_KEY !== undefined &&
        process.env.LOGBOOK_LINEAR_WORKSPACE_ID !== undefined &&
        process.env.LOGBOOK_LINEAR_TEAM_ID !== undefined
    )
  })

  test.skipIf(!liveSmokeEnabled)("loads the authenticated Linear viewer", async () => {
    const client = LinearTransport.make({
      apiToken: process.env.LINEAR_API_KEY ?? "",
    })

    const result = await Effect.runPromise(
      client.request<{ viewer: { id: string } }>({
        operationName: "ViewerSmoke",
        query: "query ViewerSmoke { viewer { id } }",
      })
    )

    expect(result.viewer.id.length).toBeGreaterThan(0)
  })
})
