import type { SyncProviderError } from "@logbook/sync/provider-port.js"
import { Effect } from "effect"

const LINEAR_PROVIDER_ID = "linear"
const DEFAULT_ENDPOINT = "https://api.linear.app/graphql"
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = 250
const MAX_BODY_BYTES = 1_048_576
const MAX_GRAPHQL_ERRORS = 20
const textEncoder = new TextEncoder()

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

type LinearGraphQLRequest = {
  readonly operationName: string
  readonly query: string
  readonly variables?: Record<string, unknown>
}

export type LinearGraphQLError = {
  readonly message?: unknown
  readonly path?: unknown
  readonly extensions?: unknown
}

export type LinearTransportFixture = {
  readonly name: string
  readonly request: {
    readonly operationName: string
    readonly variables?: Record<string, unknown>
  }
  readonly response:
    | {
        readonly status: number
        readonly headers?: Record<string, string>
        readonly body: {
          readonly data?: Record<string, unknown>
          readonly errors?: readonly LinearGraphQLError[]
        }
      }
    | { readonly networkError: "timeout" | "connection_reset" }
}

type LinearTransportOptions = {
  readonly apiToken: string
  readonly endpoint?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly retryAttempts?: number
  readonly backoffMs?: number
}

export type LinearGraphQLClient = {
  request<TData extends Record<string, unknown> = Record<string, unknown>>(
    request: LinearGraphQLRequest
  ): Effect.Effect<TData, SyncProviderError>
}

export const LinearTransport = {
  make: (options: LinearTransportOptions): LinearGraphQLClient => makeLinearGraphQLClient(options),
  fixture: (fixtures: readonly LinearTransportFixture[]): LinearGraphQLClient =>
    makeLinearGraphQLClient({
      apiToken: "fixture-token",
      fetch: fixtureFetch(fixtures),
      backoffMs: 0,
    }),
} as const

const makeLinearGraphQLClient = (options: LinearTransportOptions): LinearGraphQLClient => ({
  request: <TData extends Record<string, unknown>>(request: LinearGraphQLRequest) =>
    Effect.gen(function* () {
      const apiToken = options.apiToken.trim()
      if (apiToken.length === 0) {
        return yield* Effect.fail(
          providerError("auth_failed", false, "Linear API token is required.", {
            provider: LINEAR_PROVIDER_ID,
            reason: "missing_token",
          })
        )
      }

      return yield* requestWithRetry<TData>(request, apiToken, options)
    }),
})

const requestWithRetry = <TData extends Record<string, unknown>>(
  request: LinearGraphQLRequest,
  apiToken: string,
  options: LinearTransportOptions
): Effect.Effect<TData, SyncProviderError> =>
  Effect.gen(function* () {
    const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS
    const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS
    let attempt = 1

    while (attempt <= retryAttempts) {
      const result = yield* Effect.either(
        executeRequest<TData>(request, apiToken, options, attempt)
      )
      if (result._tag === "Right") {
        return result.right
      }

      if (!shouldRetry(result.left) || attempt >= retryAttempts) {
        return yield* Effect.fail(result.left)
      }

      if (backoffMs > 0) {
        yield* Effect.sleep(backoffMs * 2 ** (attempt - 1))
      }
      attempt += 1
    }

    return yield* Effect.fail(
      providerError("unknown", false, "Linear request failed without a final attempt.", {
        provider: LINEAR_PROVIDER_ID,
        reason: "unknown",
      })
    )
  })

const executeRequest = <TData extends Record<string, unknown>>(
  request: LinearGraphQLRequest,
  apiToken: string,
  options: LinearTransportOptions,
  attempt: number
): Effect.Effect<TData, SyncProviderError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetchWithTimeout(request, apiToken, options)
      return await parseResponse<TData>(response, attempt)
    },
    catch: (error) => mapThrownError(error, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })

const fetchWithTimeout = async (
  request: LinearGraphQLRequest,
  apiToken: string,
  options: LinearTransportOptions
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const fetchImpl = options.fetch ?? fetch

  try {
    return await fetchImpl(options.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: request.query,
        operationName: request.operationName,
        variables: request.variables ?? {},
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

const parseResponse = async <TData extends Record<string, unknown>>(
  response: Response,
  attempt: number
): Promise<TData> => {
  if (response.status === 401 || response.status === 403) {
    throw providerError("auth_failed", false, "Linear authentication failed.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "auth",
      status: response.status,
    })
  }

  if (response.status === 429) {
    throw providerError("rate_limited", true, "Linear rate limit was reached.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "rate_limited",
      retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
    })
  }

  if (response.status >= 500) {
    throw providerError("network_error", true, "Linear returned a retryable HTTP failure.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "retryable_http",
      status: response.status,
      attempts: attempt,
    })
  }

  if (response.status < 200 || response.status >= 300) {
    throw providerError("unknown", false, "Linear returned an HTTP failure.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "http",
      status: response.status,
    })
  }

  const text = await response.text()
  if (byteLength(text) > MAX_BODY_BYTES) {
    throw providerError("unknown", false, "Linear response exceeded the GraphQL body byte limit.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "malformed_response",
      maxBytes: MAX_BODY_BYTES,
    })
  }

  const parsed = parseJsonObject(text)
  const errors = Array.isArray(parsed.errors) ? parsed.errors : undefined
  if (errors !== undefined && errors.length > 0) {
    throw providerError("validation_failed", false, "Linear returned GraphQL errors.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "graphql",
      errors: summarizeGraphqlErrors(errors),
      ...(errors.length > MAX_GRAPHQL_ERRORS ? { truncated: true } : {}),
    })
  }

  if (!isRecord(parsed.data)) {
    throw providerError("unknown", false, "Linear returned a malformed GraphQL response.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "malformed_response",
    })
  }

  return parsed.data as TData
}

const fixtureFetch =
  (fixtures: readonly LinearTransportFixture[]): FetchLike =>
  async (_input, init) => {
    const request = parseFixtureRequest(init.body)
    const fixture = fixtures.find((candidate) => fixtureMatches(candidate, request))
    if (fixture === undefined) {
      return new Response(
        JSON.stringify({
          errors: [{ message: `No Linear fixture matched operation ${request.operationName}` }],
        }),
        { status: 200 }
      )
    }

    if ("networkError" in fixture.response) {
      if (fixture.response.networkError === "timeout") {
        throw providerError("timeout", true, "Linear request timed out.", {
          provider: LINEAR_PROVIDER_ID,
          reason: "timeout",
          timeoutMs: DEFAULT_TIMEOUT_MS,
        })
      }

      throw providerError("network_error", true, "Linear network connection reset.", {
        provider: LINEAR_PROVIDER_ID,
        reason: "connection_reset",
      })
    }

    return new Response(
      JSON.stringify(fixture.response.body),
      fixture.response.headers === undefined
        ? { status: fixture.response.status }
        : { status: fixture.response.status, headers: fixture.response.headers }
    )
  }

const parseFixtureRequest = (body: unknown): LinearGraphQLRequest => {
  if (typeof body !== "string") {
    return { operationName: "", query: "" }
  }

  const parsed = JSON.parse(body) as Partial<LinearGraphQLRequest>
  return {
    operationName: typeof parsed.operationName === "string" ? parsed.operationName : "",
    query: typeof parsed.query === "string" ? parsed.query : "",
    variables: isRecord(parsed.variables) ? parsed.variables : {},
  }
}

const fixtureMatches = (
  fixture: LinearTransportFixture,
  request: LinearGraphQLRequest
): boolean => {
  if (fixture.request.operationName !== request.operationName) {
    return false
  }

  const requiredVariables = fixture.request.variables ?? {}
  const actualVariables = request.variables ?? {}
  return Object.entries(requiredVariables).every(([key, value]) =>
    deepEqual(actualVariables[key], value)
  )
}

const mapThrownError = (error: unknown, timeoutMs: number): SyncProviderError => {
  if (isProviderError(error)) {
    return error
  }

  if (error instanceof Error && error.name === "AbortError") {
    return providerError("timeout", true, "Linear request timed out.", {
      provider: LINEAR_PROVIDER_ID,
      reason: "timeout",
      timeoutMs,
    })
  }

  return providerError("network_error", true, "Linear network request failed.", {
    provider: LINEAR_PROVIDER_ID,
    reason: "network_error",
  })
}

const shouldRetry = (error: SyncProviderError): boolean =>
  error.retryable && (error.code === "network_error" || error.code === "timeout")

const providerError = (
  code: SyncProviderError["code"],
  retryable: boolean,
  message: string,
  details: Record<string, unknown>
): SyncProviderError => ({
  providerId: LINEAR_PROVIDER_ID,
  code,
  retryable,
  message,
  details,
})

const isProviderError = (value: unknown): value is SyncProviderError =>
  isRecord(value) &&
  value.providerId === LINEAR_PROVIDER_ID &&
  typeof value.code === "string" &&
  typeof value.retryable === "boolean" &&
  typeof value.message === "string"

const retryAfterMs = (value: string | null): number | undefined => {
  if (value === null) {
    return undefined
  }

  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

const summarizeGraphqlErrors = (errors: readonly unknown[]): readonly Record<string, unknown>[] =>
  errors.slice(0, MAX_GRAPHQL_ERRORS).map((error) => {
    if (!isRecord(error)) {
      return { message: "Unknown GraphQL error" }
    }

    const extensions = isRecord(error.extensions) ? error.extensions : undefined
    const code = typeof extensions?.code === "string" ? extensions.code : undefined
    return {
      message: typeof error.message === "string" ? error.message : "Unknown GraphQL error",
      ...(Array.isArray(error.path) ? { path: error.path } : {}),
      ...(code === undefined ? {} : { extensions: { code } }),
    }
  })

const parseJsonObject = (text: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(text) as unknown
    if (isRecord(parsed)) {
      return parsed
    }
  } catch {
    // Fall through to the bounded malformed response error below.
  }

  throw providerError("unknown", false, "Linear returned malformed JSON.", {
    provider: LINEAR_PROVIDER_ID,
    reason: "malformed_response",
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const byteLength = (value: string): number => textEncoder.encode(value).length

const deepEqual = (left: unknown, right: unknown): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right)
