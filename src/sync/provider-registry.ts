const MAX_PROVIDER_REGISTRATIONS = 10
const MAX_PROVIDER_CONFIG_JSON_BYTES = 65_536
const DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS = 5_000
const textEncoder = new TextEncoder()

type ProviderRegistration = {
  readonly provider: string
  readonly config: Record<string, unknown>
  readonly healthTimeoutMs: number
}

export type SyncProviderRegistrySnapshot = {
  readonly config: Record<string, Record<string, unknown>>
  readonly providers: readonly ProviderRegistration[]
}

export class SyncProviderRegistry {
  readonly #providers: ProviderRegistration[]

  constructor(providers: readonly ProviderRegistration[] = []) {
    this.#providers = [...providers]
  }

  list(): readonly ProviderRegistration[] {
    return this.#providers.map(cloneProviderRegistration)
  }

  snapshot(): SyncProviderRegistrySnapshot {
    return {
      config: Object.fromEntries(
        this.#providers.map((provider) => [provider.provider, cloneConfig(provider.config)])
      ),
      providers: this.list(),
    }
  }

  healthTimeoutWarning(
    provider: string,
    elapsedMs: number
  ):
    | {
        readonly code: "provider_warning"
        readonly message: string
        readonly details: {
          readonly provider: string
          readonly elapsedMs: number
          readonly timeoutMs: number
        }
      }
    | undefined {
    const registration = this.#providers.find((entry) => entry.provider === provider)
    if (registration === undefined || elapsedMs < registration.healthTimeoutMs) {
      return undefined
    }

    return {
      code: "provider_warning",
      message: "Provider health check exceeded the timeout.",
      details: {
        provider,
        elapsedMs,
        timeoutMs: registration.healthTimeoutMs,
      },
    }
  }

  withProvider(provider: ProviderRegistration): SyncProviderRegistry {
    return new SyncProviderRegistry([...this.#providers, cloneProviderRegistration(provider)])
  }

  static readonly bounds = {
    maxProviderRegistrations: MAX_PROVIDER_REGISTRATIONS,
    providerConfigJsonBytes: MAX_PROVIDER_CONFIG_JSON_BYTES,
    providerHealthTimeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  } as const
}

type RegisterSyncProviderInput = {
  readonly provider: string
  readonly config: Record<string, unknown>
  readonly healthTimeoutMs?: number | undefined
}

export const registerSyncProvider = (
  registry: SyncProviderRegistry,
  input: RegisterSyncProviderInput
): SyncProviderRegistry => {
  validateProviderRegistrationInput(input)

  const existing = registry.snapshot().config[input.provider]
  if (existing !== undefined) {
    throw registrationError(`duplicate provider registered: ${input.provider}`, {
      provider: input.provider,
    })
  }

  const providerCount = registry.list().length
  if (providerCount >= MAX_PROVIDER_REGISTRATIONS) {
    throw registrationError(`registered providers exceed ${MAX_PROVIDER_REGISTRATIONS}`, {
      provider: input.provider,
      maxProviders: MAX_PROVIDER_REGISTRATIONS,
      registeredProviders: providerCount,
    })
  }

  const healthTimeoutMs = input.healthTimeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS
  if (!Number.isInteger(healthTimeoutMs) || healthTimeoutMs <= 0) {
    throw validationFailure("provider health timeout must be a positive integer", {
      provider: input.provider,
      healthTimeoutMs,
    })
  }

  const configBytes = textEncoder.encode(JSON.stringify(input.config)).length
  if (configBytes > MAX_PROVIDER_CONFIG_JSON_BYTES) {
    throw validationFailure(`provider config exceeds ${MAX_PROVIDER_CONFIG_JSON_BYTES} bytes`, {
      provider: input.provider,
      actualBytes: configBytes,
      maxBytes: MAX_PROVIDER_CONFIG_JSON_BYTES,
    })
  }

  return registry.withProvider({
    provider: input.provider,
    config: cloneConfig(input.config),
    healthTimeoutMs,
  })
}

const validateProviderRegistrationInput = (input: RegisterSyncProviderInput): void => {
  if (typeof input.provider !== "string" || input.provider.length === 0) {
    throw validationFailure("provider is required", {
      field: "provider",
    })
  }

  if (!isRecord(input.config)) {
    throw validationFailure("provider config must be an object", {
      provider: input.provider,
    })
  }
}

const cloneProviderRegistration = (provider: ProviderRegistration): ProviderRegistration => ({
  provider: provider.provider,
  config: cloneConfig(provider.config),
  healthTimeoutMs: provider.healthTimeoutMs,
})

const cloneConfig = (config: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(config)) as Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const validationFailure = (message: string, details?: Record<string, unknown>): Error => {
  const error = new Error(message) as Error & {
    code?: string
    details?: Record<string, unknown>
  }
  error.code = "validation_error"
  if (details !== undefined) {
    error.details = details
  }
  return error
}

const registrationError = (message: string, details?: Record<string, unknown>): Error => {
  const error = new Error(message) as Error & {
    code?: string
    details?: Record<string, unknown>
  }
  error.code = "tool_registration_error"
  if (details !== undefined) {
    error.details = details
  }
  return error
}
