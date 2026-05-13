import { describe, expect, test } from "bun:test"
import { LinearTransport } from "@logbook/sync/linear/transport.js"
import { Effect } from "effect"

const query = "query Viewer { viewer { id name } }"

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

describe("Linear GraphQL transport", () => {
  test("sends Linear API keys as raw Authorization header values", async () => {
    let authorizationHeader: string | undefined
    const client = LinearTransport.make({
      apiToken: "lin_api_test",
      fetch: async (_input, init) => {
        const headers = init.headers as Record<string, string>
        authorizationHeader = headers.authorization
        return new Response(JSON.stringify({ data: { viewer: { id: "user_1" } } }), {
          status: 200,
        })
      },
    })

    const data = await run(
      client.request<{ viewer: { id: string } }>({ operationName: "Viewer", query })
    )

    expect(data.viewer.id).toBe("user_1")
    expect(authorizationHeader).toBe("lin_api_test")
  })

  test("matches fixtures by operation name and required variables", async () => {
    const client = LinearTransport.fixture([
      {
        name: "viewer lookup",
        request: {
          operationName: "Viewer",
          variables: { workspaceId: "workspace_1" },
        },
        response: {
          status: 200,
          body: {
            data: {
              viewer: { id: "user_1", name: "Ada" },
            },
          },
        },
      },
    ])

    const data = await run(
      client.request<{ viewer: { id: string; name: string } }>({
        operationName: "Viewer",
        query,
        variables: { workspaceId: "workspace_1", ignoredByFixture: true },
      })
    )

    expect(data).toEqual({
      viewer: { id: "user_1", name: "Ada" },
    })
  })

  test("maps missing token, rate limit, GraphQL, and malformed responses to provider errors", async () => {
    const missingToken = LinearTransport.make({
      apiToken: "",
      fetch: async () => new Response("{}"),
    })
    const missingTokenResult = await Effect.runPromiseExit(
      missingToken.request({ operationName: "Viewer", query })
    )
    expect(missingTokenResult._tag).toBe("Failure")
    if (missingTokenResult._tag !== "Failure") {
      throw new Error("expected missing token failure")
    }
    expect(String(missingTokenResult.cause)).toContain("missing_token")

    const rateLimited = LinearTransport.fixture([
      {
        name: "rate limit",
        request: { operationName: "Viewer" },
        response: { status: 429, headers: { "retry-after": "2" }, body: { data: {} } },
      },
    ])
    const rateLimitResult = await run(
      Effect.either(rateLimited.request({ operationName: "Viewer", query }))
    )
    expect(rateLimitResult).toMatchObject({
      _tag: "Left",
      left: {
        providerId: "linear",
        code: "rate_limited",
        retryable: true,
        details: {
          provider: "linear",
          reason: "rate_limited",
          retryAfterMs: 2000,
        },
      },
    })

    const graphql = LinearTransport.fixture([
      {
        name: "graphql errors",
        request: { operationName: "Viewer" },
        response: {
          status: 200,
          body: {
            errors: Array.from({ length: 25 }, (_, index) => ({
              message: `error ${index + 1}`,
              path: ["viewer"],
              extensions: { code: "GRAPHQL_ERROR", ignored: "raw" },
            })),
          },
        },
      },
    ])
    const graphqlResult = await run(
      Effect.either(graphql.request({ operationName: "Viewer", query }))
    )
    expect(graphqlResult).toMatchObject({
      _tag: "Left",
      left: {
        code: "validation_failed",
        details: {
          reason: "graphql",
          truncated: true,
        },
      },
    })
    if (graphqlResult._tag === "Left") {
      expect((graphqlResult.left.details?.errors as unknown[]).length).toBe(20)
    }

    const malformed = LinearTransport.make({
      apiToken: "token",
      fetch: async () => new Response("not-json", { status: 200 }),
      backoffMs: 0,
    })
    const malformedResult = await run(
      Effect.either(malformed.request({ operationName: "Viewer", query }))
    )
    expect(malformedResult).toMatchObject({
      _tag: "Left",
      left: {
        code: "unknown",
        retryable: false,
        details: {
          reason: "malformed_response",
        },
      },
    })
  })

  test("retries retryable HTTP failures with bounded attempts", async () => {
    let attempts = 0
    const client = LinearTransport.make({
      apiToken: "token",
      retryAttempts: 3,
      backoffMs: 0,
      fetch: async () => {
        attempts += 1
        return attempts < 3
          ? new Response(JSON.stringify({ data: {} }), { status: 503 })
          : new Response(JSON.stringify({ data: { viewer: { id: "user_1" } } }), { status: 200 })
      },
    })

    const data = await run(
      client.request<{ viewer: { id: string } }>({ operationName: "Viewer", query })
    )

    expect(data).toEqual({ viewer: { id: "user_1" } })
    expect(attempts).toBe(3)
  })

  test("fails after final retry attempt and maps fixture timeout", async () => {
    let attempts = 0
    const retryFailure = LinearTransport.make({
      apiToken: "token",
      retryAttempts: 3,
      backoffMs: 0,
      fetch: async () => {
        attempts += 1
        return new Response(JSON.stringify({ data: {} }), { status: 503 })
      },
    })

    const retryResult = await run(
      Effect.either(retryFailure.request({ operationName: "Viewer", query }))
    )
    expect(retryResult).toMatchObject({
      _tag: "Left",
      left: {
        code: "network_error",
        retryable: true,
        details: {
          reason: "retryable_http",
          status: 503,
          attempts: 3,
        },
      },
    })
    expect(attempts).toBe(3)

    const timeout = LinearTransport.fixture([
      {
        name: "timeout",
        request: { operationName: "Viewer" },
        response: { networkError: "timeout" },
      },
    ])
    const timeoutResult = await run(
      Effect.either(timeout.request({ operationName: "Viewer", query }))
    )
    expect(timeoutResult).toMatchObject({
      _tag: "Left",
      left: {
        code: "timeout",
        details: {
          reason: "timeout",
          timeoutMs: 10000,
        },
      },
    })
  })

  test("rejects oversized GraphQL response bodies", async () => {
    const client = LinearTransport.make({
      apiToken: "token",
      fetch: async () => new Response(JSON.stringify({ data: { value: "x".repeat(1_048_577) } })),
    })

    const result = await run(Effect.either(client.request({ operationName: "Viewer", query })))

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        code: "unknown",
        details: {
          reason: "malformed_response",
          maxBytes: 1048576,
        },
      },
    })
  })
})
