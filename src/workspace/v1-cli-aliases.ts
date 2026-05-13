import type { ToolResult } from "@logbook/shared/result.js"
import type { Task } from "@logbook/task/schema.js"
import { TaskSchema } from "@logbook/task/schema.js"
import { toV1Task } from "@logbook/task/v1-compat.js"

type V1CliAlias = {
  readonly alias: string
  readonly toolId: string
  readonly compatibility: "v1"
}

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]

type V1CliTranslation = {
  readonly toolId: string
  readonly input: Record<string, unknown>
  readonly warnings: readonly ToolWarning[]
  readonly withCompatibilityOutput?: (<T>(envelope: ToolResult<T>) => ToolResult<T>) | undefined
}

const estimateComplexity = (fibonacci: number): Task["estimate"]["complexity"] => {
  if (fibonacci <= 2) return "trivial"
  if (fibonacci <= 5) return "small"
  if (fibonacci <= 8) return "medium"
  if (fibonacci <= 13) return "large"
  return "complex"
}

const aliasDefinitions = [
  ["create-task", "task.create"],
  ["list-tasks", "task.list"],
  ["current-task", "task.current"],
  ["update-task", "task.update"],
  ["edit-task", "task.edit"],
  ["init", "workspace.init"],
] as const

export const v1CliAliases = Object.freeze(
  aliasDefinitions.map(([alias, toolId]) => ({
    alias,
    toolId,
    compatibility: "v1" as const,
  }))
) satisfies readonly V1CliAlias[]

export const translateV1CliCommand = (
  alias: string,
  input: Record<string, unknown>
): V1CliTranslation | null => {
  const command = v1CliAliases.find((candidate) => candidate.alias === alias)
  if (command === undefined) {
    return null
  }

  const translated = translateInput(command.toolId, input)
  const warnings =
    translated.fields.length === 0
      ? []
      : [
          {
            code: "compatibility_mapping_applied",
            message: "V1 CLI arguments were translated to v2 tool input.",
            details: {
              alias,
              toolId: command.toolId,
              fields: translated.fields,
            },
          },
        ]

  const translation = {
    toolId: command.toolId,
    input: translated.input,
    warnings,
  }
  Object.defineProperty(translation, "withCompatibilityOutput", {
    enumerable: false,
    value: <T>(envelope: ToolResult<T>): ToolResult<T> =>
      withV1CompatibilityOutput(alias, envelope, warnings),
  })

  return translation
}

const translateInput = (
  toolId: string,
  input: Record<string, unknown>
): { readonly input: Record<string, unknown>; readonly fields: readonly string[] } => {
  if (toolId === "task.create" || toolId === "task.edit") {
    return translateTaskWriteInput(toolId, input)
  }

  if (toolId === "task.update") {
    return translateTaskUpdateInput(input)
  }

  if (toolId === "task.list" || toolId === "task.current") {
    return translateTaskFilterInput(input)
  }

  return { input, fields: [] }
}

const translateTaskWriteInput = (
  _toolId: string,
  input: Record<string, unknown>
): { readonly input: Record<string, unknown>; readonly fields: readonly string[] } => {
  const fields: string[] = []
  const output = { ...input }

  mapListField(
    output,
    fields,
    ["definition_of_done", "definition-of-done", "definitionOfDone"],
    "definitionOfDone"
  )
  mapListField(output, fields, ["test_cases", "test-cases", "testCases"], "definitionOfReady", {
    enumerable: false,
  })
  mapScalarField(
    output,
    fields,
    ["assigned_session", "assigned-session", "assignedSession"],
    "sessionId"
  )
  mapModelField(output, fields)
  mapEstimateField(output, fields)

  return { input: output, fields }
}

const translateTaskUpdateInput = (
  input: Record<string, unknown>
): { readonly input: Record<string, unknown>; readonly fields: readonly string[] } => {
  const fields: string[] = []
  const output = { ...input }

  mapScalarField(output, fields, ["new_status", "new-status", "newStatus"], "newStatus")

  const title = readFirst(output, ["comment_title", "comment-title", "commentTitle"], fields)
  const content = readFirst(
    output,
    ["comment_content", "comment-content", "commentContent"],
    fields
  )
  const kind = readFirst(output, ["comment_kind", "comment-kind", "commentKind"], fields)
  const replyToCommentId = readFirst(
    output,
    ["comment_reply_to", "comment-reply-to", "commentReplyTo"],
    fields
  )
  if (title !== undefined || content !== undefined || replyToCommentId !== undefined) {
    output.comment = {
      ...(title === undefined ? {} : { title: String(title) }),
      content: content === undefined ? "" : String(content),
      ...(kind === undefined ? {} : { kind: String(kind) }),
      ...(replyToCommentId === undefined ? {} : { replyToCommentId: String(replyToCommentId) }),
    }
  }

  return { input: output, fields }
}

const translateTaskFilterInput = (
  input: Record<string, unknown>
): { readonly input: Record<string, unknown>; readonly fields: readonly string[] } => {
  const fields: string[] = []
  const output = { ...input }
  mapScalarField(
    output,
    fields,
    ["assigned_session", "assigned-session", "assignedSession"],
    "sessionId"
  )
  return { input: output, fields }
}

const mapListField = (
  output: Record<string, unknown>,
  fields: string[],
  candidates: readonly string[],
  target: string,
  options: { readonly enumerable?: boolean } = {}
): void => {
  const value = readFirst(output, candidates, fields)
  if (value !== undefined) {
    setOutputField(output, target, normalizeList(value).join("\n"), options)
  }
}

const mapScalarField = (
  output: Record<string, unknown>,
  fields: string[],
  candidates: readonly string[],
  target: string
): void => {
  const value = readFirst(output, candidates, fields)
  if (value !== undefined) {
    setOutputField(output, target, value)
  }
}

const setOutputField = (
  output: Record<string, unknown>,
  target: string,
  value: unknown,
  options: { readonly enumerable?: boolean } = {}
): void => {
  Object.defineProperty(output, target, {
    configurable: true,
    enumerable: options.enumerable ?? true,
    value,
    writable: true,
  })
}

const mapModelField = (output: Record<string, unknown>, fields: string[]): void => {
  const value = readFirst(output, ["assigned_model", "assigned-model", "assignedModel"], fields)
  if (value !== undefined) {
    output.model = { id: String(value) }
  }
}

const mapEstimateField = (output: Record<string, unknown>, fields: string[]): void => {
  const estimation = readFirst(output, ["estimation"], fields)
  const predictedKTokens = readFirst(output, ["predictedKTokens", "predicted-k-tokens"], fields)
  if (estimation === undefined && predictedKTokens === undefined) {
    return
  }

  const fibonacci = Number(estimation ?? 1)
  output.estimate = {
    predictedKTokens: Number(predictedKTokens ?? 0),
    fibonacci,
    complexity: estimateComplexity(fibonacci),
    confidence: "medium",
  }
}

const readFirst = (
  output: Record<string, unknown>,
  candidates: readonly string[],
  fields: string[]
): unknown => {
  for (const candidate of candidates) {
    if (Object.hasOwn(output, candidate)) {
      const value = output[candidate]
      delete output[candidate]
      fields.push(candidate)
      return value
    }
  }

  return undefined
}

const normalizeList = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
      }
    } catch {}

    const trimmed = value.trim()
    return trimmed.length === 0 ? [] : [trimmed]
  }

  if (value === undefined || value === null) {
    return []
  }

  return [String(value)]
}

const withV1CompatibilityOutput = <T>(
  alias: string,
  envelope: ToolResult<T>,
  warnings: readonly ToolWarning[]
): ToolResult<T> => {
  if (!envelope.ok || v1CliAliases.every((candidate) => candidate.alias !== alias)) {
    return envelope
  }

  const data = addCompatibilityData(envelope.data)
  const nextWarnings = [...(envelope.warnings ?? []), ...warnings]

  return {
    ok: true,
    data,
    ...(nextWarnings.length === 0 ? {} : { warnings: nextWarnings }),
  } as ToolResult<T>
}

const addCompatibilityData = <T>(data: T): T => {
  if (!isRecord(data)) {
    return data
  }

  const compat = buildCompatibility(data)
  if (compat === undefined) {
    return data
  }

  return {
    ...data,
    compat: {
      ...(isRecord(data.compat) ? data.compat : {}),
      v1: compat,
    },
  } as T
}

const buildCompatibility = (data: Record<string, unknown>): Record<string, unknown> | undefined => {
  const compat: Record<string, unknown> = {}
  const task = toTask(data.task)
  if (task !== undefined) {
    compat.task = toV1Task(task)
  }

  if (Array.isArray(data.items)) {
    const tasks = data.items.map(toTask).filter((item): item is Task => item !== undefined)
    if (tasks.length > 0) {
      compat.items = tasks.map(toV1Task)
    }
  }

  return Object.keys(compat).length === 0 ? undefined : compat
}

const toTask = (value: unknown): Task | undefined => {
  const parsed = TaskSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
