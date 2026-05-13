import type { ToolResult } from "@logbook/shared/result.js"
import {
  defaultLinearApiTokenEnv,
  ensureDotenvGitignored,
  parseLinearTeamUrl,
  readLinearApiToken,
  upsertDotenvValue,
  upsertLinearWorkspaceConfig,
} from "@logbook/sync/linear/config.js"
import { type LinearGraphQLClient, LinearTransport } from "@logbook/sync/linear/transport.js"
import { Context, Effect } from "effect"

const LINEAR_PROVIDER_ID = "linear"
const LINEAR_RESOLVE_OPERATION = "LinearResolveSetup"

const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

export type SetupLinearSyncInput = {
  readonly teamUrl?: string | undefined
  readonly workspaceId?: string | undefined
  readonly teamId?: string | undefined
  readonly teamKey?: string | undefined
  readonly projectId?: string | undefined
  readonly apiTokenEnv?: string | undefined
  readonly apiToken?: string | undefined
  readonly writeEnv?: boolean | undefined
  readonly checkProvider?: boolean | undefined
}

export type SetupLinearSyncResult = {
  readonly configPath: string
  readonly apiTokenEnv: string
  readonly workspaceId: string
  readonly defaultTeamId: string
  readonly defaultProjectId?: string | undefined
  readonly resolvedFromUrl?: boolean | undefined
  readonly dotenv?: {
    readonly path: string
    readonly created: boolean
    readonly updated: boolean
  }
  readonly gitignore?: {
    readonly path?: string | undefined
    readonly updated: boolean
  }
}

type LinearResolveResponse = {
  readonly organization?: {
    readonly id?: string
    readonly urlKey?: string
  } | null
  readonly teams?: {
    readonly nodes?: readonly {
      readonly id?: string
      readonly key?: string
      readonly name?: string
    }[]
  } | null
}

type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

export const setupLinearSync = (
  input: SetupLinearSyncInput
): Effect.Effect<ToolResult<SetupLinearSyncResult>, never, LinearGraphQLClient> =>
  Effect.gen(function* () {
    const apiTokenEnv =
      input.apiTokenEnv !== undefined && input.apiTokenEnv.length > 0
        ? input.apiTokenEnv
        : defaultLinearApiTokenEnv

    const parsedUrl = input.teamUrl === undefined ? undefined : parseLinearTeamUrl(input.teamUrl)
    if (input.teamUrl !== undefined && parsedUrl === undefined) {
      return failure(
        "validation_error",
        "Linear team URL must look like https://linear.app/<workspace>/team/<team>.",
        {
          provider: LINEAR_PROVIDER_ID,
          teamUrl: input.teamUrl,
        }
      )
    }

    const token =
      typeof input.apiToken === "string" && input.apiToken.trim().length > 0
        ? input.apiToken.trim()
        : readLinearApiToken({ apiTokenEnv })

    let workspaceId = input.workspaceId
    let defaultTeamId = input.teamId
    const shouldResolve =
      parsedUrl !== undefined || (workspaceId === undefined && input.teamKey !== undefined)
    if (shouldResolve) {
      if (token === undefined) {
        return failure(
          "provider_error",
          "Linear API token is required to resolve workspace and team ids.",
          {
            provider: LINEAR_PROVIDER_ID,
            apiTokenEnv,
          }
        )
      }

      const client =
        typeof input.apiToken === "string" && input.apiToken.trim().length > 0
          ? LinearTransport.make({ apiToken: input.apiToken.trim() })
          : yield* LinearGraphQLClientTag
      const resolved = yield* Effect.either(
        client.request<LinearResolveResponse>({
          operationName: LINEAR_RESOLVE_OPERATION,
          query: LINEAR_RESOLVE_QUERY,
          variables: {
            teamKey: parsedUrl?.teamKey ?? input.teamKey,
          },
        })
      )
      if (resolved._tag === "Left") {
        return failure("provider_error", "Linear setup failed to resolve workspace and team.", {
          provider: LINEAR_PROVIDER_ID,
          error: resolved.left,
        })
      }

      const workspaceSlug = parsedUrl?.workspaceSlug
      const organization = resolved.right.organization
      if (
        workspaceSlug !== undefined &&
        organization?.urlKey !== undefined &&
        organization.urlKey !== workspaceSlug
      ) {
        return failure("validation_error", "Linear API token belongs to a different workspace.", {
          provider: LINEAR_PROVIDER_ID,
          expectedWorkspace: workspaceSlug,
          actualWorkspace: organization.urlKey,
        })
      }

      const teamKey = parsedUrl?.teamKey ?? input.teamKey
      const team = resolved.right.teams?.nodes?.find((candidate) => candidate.key === teamKey)
      if (organization?.id === undefined || team?.id === undefined) {
        return failure("not_found", "Linear workspace or team was not found.", {
          provider: LINEAR_PROVIDER_ID,
          workspace: workspaceSlug,
          teamKey,
        })
      }
      workspaceId = organization.id
      defaultTeamId = team.id
    }

    if (workspaceId === undefined || workspaceId.length === 0) {
      return failure("validation_error", "Linear workspaceId is required.", {
        provider: LINEAR_PROVIDER_ID,
      })
    }
    if (defaultTeamId === undefined || defaultTeamId.length === 0) {
      return failure("validation_error", "Linear teamId is required.", {
        provider: LINEAR_PROVIDER_ID,
      })
    }

    const configured = yield* Effect.promise(() =>
      upsertLinearWorkspaceConfig({
        apiTokenEnv,
        workspaceId,
        defaultTeamId,
        defaultProjectId: input.projectId,
      })
    )
    if (!configured.ok) {
      return configured
    }

    const dotenv =
      input.writeEnv === true && token !== undefined
        ? yield* Effect.promise(() => upsertDotenvValue({ name: apiTokenEnv, value: token }))
        : undefined
    if (dotenv !== undefined && !dotenv.ok) {
      return dotenv
    }

    const gitignore = yield* Effect.promise(() => ensureDotenvGitignored())
    if (!gitignore.ok) {
      return gitignore
    }

    return {
      ok: true,
      data: {
        configPath: configured.data.path,
        apiTokenEnv: configured.data.linear.apiTokenEnv,
        workspaceId,
        defaultTeamId,
        ...(input.projectId === undefined ? {} : { defaultProjectId: input.projectId }),
        ...(parsedUrl === undefined ? {} : { resolvedFromUrl: true }),
        ...(dotenv?.data === undefined ? {} : { dotenv: dotenv.data }),
        gitignore: gitignore.data,
      },
    }
  })

const LINEAR_RESOLVE_QUERY = `
query LinearResolveSetup($teamKey: String) {
  organization { id urlKey }
  teams(first: 100, filter: { key: { eq: $teamKey } }) {
    nodes { id key name }
  }
}
`

const failure = (
  code: ToolError["code"],
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  },
})
