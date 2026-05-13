// ohtools bundles its own copy of effect; brand identity drift is bridged via local casts.
import type { OhtoolsError, RunResult, RuntimeOptions } from "@bosun-sh/ohtools"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { toToolResult } from "@logbook/plugin/results.js"
import type { ToolResult } from "@logbook/shared/result.js"
import { readLinearApiToken, readLinearWorkspaceConfig } from "@logbook/sync/linear/config.js"
import { pullLinearSync } from "@logbook/sync/linear/pull.js"
import { pushLinearSync } from "@logbook/sync/linear/push.js"
import { Effect } from "effect"
import { mcpToolRegistry } from "./mcp-tools.js"

const DEFAULT_MAX_MCP_INPUT_JSON_BYTES = 1_048_576
const DEFAULT_MAX_RESULT_JSON_BYTES = 4_194_304
const TASK_WRITE_TOOL_IDS = new Set([
  "task.assign.model",
  "task.assign.phase-model",
  "task.assign.session",
  "task.create",
  "task.edit",
  "task.estimate",
  "task.update",
])
const textEncoder = new TextEncoder()

type McpErrorCode = "mcp_error" | "schema_validation_error" | "adapter_error"

type McpToolCallParams = {
  readonly name?: unknown
  readonly arguments?: unknown
}

type McpTextContentResult = {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }]
}

export type CreateMcpServerOptions = {
  readonly layer?: RuntimeOptions["layer"] | undefined
  readonly workspaceRoot?: string | undefined
  readonly maxMcpInputJsonBytes?: number | undefined
  readonly maxResultJsonBytes?: number | undefined
}

type McpServer = {
  readonly listTools: () => { readonly tools: ReturnType<typeof mcpToolRegistry.listTools> }
  readonly callTool: (params: McpToolCallParams) => Promise<McpTextContentResult>
  readonly dispatch: (method: string, params?: unknown) => Promise<unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toolError = (
  code: McpErrorCode,
  message: string,
  details?: Record<string, unknown>
): Extract<ToolResult<never>, { ok: false }>["error"] => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
})

const errorEnvelope = (
  code: McpErrorCode,
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: toolError(code, message, details),
})

const textContent = (envelope: ToolResult<unknown>): McpTextContentResult => ({
  content: [{ type: "text", text: JSON.stringify(envelope) }],
})

const appendWarnings = <T>(
  envelope: ToolResult<T>,
  warnings: readonly NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number][]
): ToolResult<T> => {
  if (!envelope.ok || warnings.length === 0) {
    return envelope
  }

  return {
    ...envelope,
    warnings: [...(envelope.warnings ?? []), ...warnings],
  }
}

const publicSchemaFor = (toolId: string) =>
  Object.hasOwn(publicToolSchemas, toolId)
    ? publicToolSchemas[toolId as keyof typeof publicToolSchemas]
    : undefined

const enforceInputBound = (
  input: unknown,
  options: CreateMcpServerOptions
): ToolResult<never> | null => {
  const maxBytes = options.maxMcpInputJsonBytes ?? DEFAULT_MAX_MCP_INPUT_JSON_BYTES
  const actualBytes = textEncoder.encode(JSON.stringify(input)).length
  if (actualBytes <= maxBytes) {
    return null
  }

  return errorEnvelope(
    "schema_validation_error",
    `MCP tool input JSON exceeds ${maxBytes} bytes.`,
    {
      actualBytes,
      maxBytes,
    }
  )
}

const enforceResultBound = <T>(
  envelope: ToolResult<T>,
  options: CreateMcpServerOptions
): ToolResult<T> => {
  const maxBytes = options.maxResultJsonBytes ?? DEFAULT_MAX_RESULT_JSON_BYTES
  const bytes = textEncoder.encode(JSON.stringify(envelope)).length
  if (bytes <= maxBytes) {
    return envelope
  }

  return errorEnvelope("adapter_error", `Tool result JSON exceeds ${maxBytes} bytes.`, {
    maxBytes,
  }) as ToolResult<T>
}

const validateInput = (toolId: string, input: unknown): ToolResult<never> | null => {
  if (!isRecord(input)) {
    return errorEnvelope("schema_validation_error", "MCP tool input must be a JSON object.")
  }

  const schema = publicSchemaFor(toolId)
  if (schema === undefined) {
    return errorEnvelope("mcp_error", `Unknown MCP tool: ${toolId}.`)
  }

  try {
    schema.parse(input)
    return null
  } catch (cause) {
    return errorEnvelope("schema_validation_error", "MCP tool input failed schema validation.", {
      cause: String(cause),
    })
  }
}

export const createMcpServer = (options: CreateMcpServerOptions = {}): McpServer => {
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const listTools = () => ({ tools: mcpToolRegistry.listTools() })

  const callTool = async (params: McpToolCallParams): Promise<McpTextContentResult> => {
    if (typeof params.name !== "string" || params.name.length === 0) {
      return textContent(errorEnvelope("mcp_error", "MCP tools/call requires a tool name."))
    }

    if (!mcpToolRegistry.hasTool(params.name)) {
      return textContent(errorEnvelope("mcp_error", `Unknown MCP tool: ${params.name}.`))
    }

    const input = params.arguments ?? {}
    const inputBoundError = enforceInputBound(input, options)
    if (inputBoundError !== null) {
      return textContent(inputBoundError)
    }

    const inputValidationError = validateInput(params.name, input)
    if (inputValidationError !== null) {
      return textContent(inputValidationError)
    }

    const autoWarnings: NonNullable<
      Extract<ToolResult<never>, { ok: true }>["warnings"]
    >[number][] = []
    if (shouldAutoLinearPull(params.name)) {
      autoWarnings.push(...(await runAutomaticLinearSync("pull", workspaceRoot, options.layer)))
    }

    const runtime = mcpToolRegistry.runtime({ layer: options.layer })
    const runResult = await Effect.runPromiseExit(
      runtime.run({
        toolId: params.name,
        input,
      }) as unknown as Effect.Effect<RunResult<unknown>, OhtoolsError, never>
    )

    if (runResult._tag === "Failure") {
      return textContent(errorEnvelope("mcp_error", "MCP adapter failed to run the tool."))
    }

    let envelope = toToolResult(runResult.value.output, [
      ...runResult.value.warnings,
      ...autoWarnings,
    ])
    if (envelope.ok && shouldAutoLinearPush(params.name)) {
      envelope = appendWarnings(
        envelope,
        await runAutomaticLinearSync("push", workspaceRoot, options.layer)
      )
    }

    return textContent(enforceResultBound(envelope, options))
  }

  const dispatch = async (method: string, params: unknown = {}): Promise<unknown> => {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "logbook", version: "2.0.0" },
        }
      case "tools/list":
        return listTools()
      case "tools/call":
        return callTool(isRecord(params) ? params : {})
      default:
        return textContent(errorEnvelope("mcp_error", `Unknown MCP method: ${method}.`))
    }
  }

  return {
    listTools,
    callTool,
    dispatch,
  }
}

const shouldAutoLinearPull = (toolId: string): boolean => !toolId.startsWith("sync.")

const shouldAutoLinearPush = (toolId: string): boolean => TASK_WRITE_TOOL_IDS.has(toolId)

const runAutomaticLinearSync = async (
  operation: "pull" | "push",
  workspaceRoot: string,
  layer: RuntimeOptions["layer"] | undefined
): Promise<
  readonly NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number][]
> => {
  if (layer === undefined) {
    return []
  }

  const configResult = await readLinearWorkspaceConfig(workspaceRoot)
  if (!configResult.ok || configResult.data === undefined) {
    return []
  }

  if (readLinearApiToken(configResult.data, workspaceRoot) === undefined) {
    return []
  }

  const effect =
    operation === "pull" ? pullLinearSync({ dryRun: false }) : pushLinearSync({ dryRun: false })
  const provided = Effect.provide(
    effect as unknown as Effect.Effect<ToolResult<unknown>, never, never>,
    layer as never
  ) as Effect.Effect<ToolResult<unknown>, never, never>

  try {
    const result = await Effect.runPromise(provided)
    if (result.ok) {
      return result.warnings ?? []
    }

    return [
      {
        code: "auto_sync_failed",
        message: `Automatic Linear ${operation} failed.`,
        details: {
          operation,
          error: result.error,
        },
      },
    ]
  } catch (cause) {
    return [
      {
        code: "auto_sync_failed",
        message: `Automatic Linear ${operation} failed.`,
        details: {
          operation,
          cause: String(cause),
        },
      },
    ]
  }
}
