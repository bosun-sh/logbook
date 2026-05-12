import { readFileSync } from "node:fs"
import { readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { ToolResult } from "@logbook/shared/result.js"
import type { Task } from "@logbook/task/schema.js"

const DEFAULT_LINEAR_API_TOKEN_ENV = "LINEAR_API_KEY"
const MAX_WORKSPACE_CONFIG_BYTES = 65_536
const MAX_DOTENV_BYTES = 65_536
const textEncoder = new TextEncoder()

export type LinearWorkspaceConfig = {
  readonly apiTokenEnv: string
  readonly workspaceId?: string
  readonly defaultTeamId?: string
  readonly defaultProjectId?: string
  readonly statusMapping?: {
    readonly linearStateTypeToTaskStatus?: Record<string, Task["status"]>
    readonly linearStateIdToTaskStatus?: Record<string, Task["status"]>
    readonly taskStatusToLinearStateId?: Record<Task["status"], string>
  }
  readonly labelMapping?: {
    readonly labelNameToTopic?: Record<string, string>
  }
}

export type WorkspaceLinearConfigResult =
  | { readonly ok: true; readonly data: LinearWorkspaceConfig | undefined }
  | { readonly ok: false; readonly error: ToolError }

export type DotenvWriteResult = {
  readonly path: string
  readonly created: boolean
  readonly updated: boolean
}

export type ParsedLinearTeamUrl = {
  readonly workspaceSlug: string
  readonly teamKey: string
}

type WorkspaceConfig = Record<string, unknown>
type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

export const defaultLinearApiTokenEnv = DEFAULT_LINEAR_API_TOKEN_ENV

export const parseLinearTeamUrl = (value: string): ParsedLinearTeamUrl | undefined => {
  try {
    const url = new URL(value)
    if (url.hostname !== "linear.app") {
      return undefined
    }
    const [workspaceSlug, segment, teamKey] = url.pathname.split("/").filter(Boolean)
    if (
      workspaceSlug === undefined ||
      segment !== "team" ||
      teamKey === undefined ||
      workspaceSlug.length === 0 ||
      teamKey.length === 0
    ) {
      return undefined
    }
    return { workspaceSlug, teamKey }
  } catch {
    return undefined
  }
}

export const readLinearWorkspaceConfig = async (
  workspaceRoot = process.cwd()
): Promise<WorkspaceLinearConfigResult> => {
  const result = await readWorkspaceConfig(workspaceRoot, false)
  if (!result.ok) {
    return result
  }
  const parsed = result.data
  if (!isRecord(parsed) || parsed.schemaVersion !== "2" || !isRecord(parsed.linear)) {
    return { ok: true, data: undefined }
  }

  return { ok: true, data: parseLinearConfig(parsed.linear) }
}

export const readLinearApiToken = (
  config: LinearWorkspaceConfig | undefined,
  workspaceRoot = process.cwd()
): string | undefined => {
  const envName = config?.apiTokenEnv ?? DEFAULT_LINEAR_API_TOKEN_ENV
  const explicit = process.env[envName]
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim()
  }

  const dotenv = readDotenvSync(resolve(workspaceRoot, ".env"))
  const value = dotenv[envName]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export const upsertLinearWorkspaceConfig = async (input: {
  readonly workspaceRoot?: string | undefined
  readonly apiTokenEnv?: string | undefined
  readonly workspaceId: string
  readonly defaultTeamId: string
  readonly defaultProjectId?: string | undefined
}): Promise<
  ToolResult<{
    readonly path: string
    readonly linear: LinearWorkspaceConfig
  }>
> => {
  const workspaceRoot = input.workspaceRoot ?? process.cwd()
  const configPath = resolve(workspaceRoot, ".logbook/config.json")
  const current = await readWorkspaceConfig(workspaceRoot, true)
  if (!current.ok) {
    return current
  }

  if (!isRecord(current.data) || current.data.schemaVersion !== "2") {
    return {
      ok: false,
      error: workspaceError("Workspace config is not compatible with v2.", {
        path: ".logbook/config.json",
      }),
    }
  }

  const existingLinear = isRecord(current.data.linear) ? current.data.linear : {}
  const apiTokenEnv =
    input.apiTokenEnv !== undefined && input.apiTokenEnv.length > 0
      ? input.apiTokenEnv
      : typeof existingLinear.apiTokenEnv === "string" && existingLinear.apiTokenEnv.length > 0
        ? existingLinear.apiTokenEnv
        : DEFAULT_LINEAR_API_TOKEN_ENV
  const nextLinear = {
    ...existingLinear,
    apiTokenEnv,
    workspaceId: input.workspaceId,
    defaultTeamId: input.defaultTeamId,
    ...(input.defaultProjectId === undefined ? {} : { defaultProjectId: input.defaultProjectId }),
  }
  const nextConfig: WorkspaceConfig = {
    ...current.data,
    linear: nextLinear,
  }

  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8")
  return {
    ok: true,
    data: {
      path: configPath,
      linear: parseLinearConfig(nextLinear),
    },
  }
}

export const upsertDotenvValue = async (input: {
  readonly workspaceRoot?: string | undefined
  readonly name: string
  readonly value: string
}): Promise<ToolResult<DotenvWriteResult>> => {
  const dotenvPath = resolve(input.workspaceRoot ?? process.cwd(), ".env")
  const existing = await readOptionalText(dotenvPath, ".env", MAX_DOTENV_BYTES)
  if (!existing.ok) {
    return existing
  }

  const lines = existing.data?.split(/\r?\n/) ?? []
  let updated = false
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${input.name}=`)) {
      updated = true
      return `${input.name}=${input.value}`
    }
    return line
  })
  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("")
    }
    nextLines.push(`${input.name}=${input.value}`)
  }
  const content = `${nextLines.filter((line, index) => index < nextLines.length - 1 || line !== "").join("\n")}\n`
  await writeFile(dotenvPath, content, "utf8")
  return {
    ok: true,
    data: {
      path: dotenvPath,
      created: existing.data === undefined,
      updated,
    },
  }
}

export const ensureDotenvGitignored = async (
  workspaceRoot = process.cwd()
): Promise<ToolResult<{ readonly path?: string | undefined; readonly updated: boolean }>> => {
  const gitignorePath = resolve(workspaceRoot, ".gitignore")
  const existing = await readOptionalText(gitignorePath, ".gitignore", MAX_DOTENV_BYTES)
  if (!existing.ok) {
    return existing
  }
  if (existing.data === undefined) {
    return { ok: true, data: { updated: false } }
  }
  const lines = existing.data.split(/\r?\n/)
  if (lines.some((line) => line.trim() === ".env" || line.trim() === ".env.*")) {
    return { ok: true, data: { path: gitignorePath, updated: false } }
  }
  const next = `${existing.data.trimEnd()}\n.env\n.env.*\n`
  await writeFile(gitignorePath, next, "utf8")
  return { ok: true, data: { path: gitignorePath, updated: true } }
}

const readWorkspaceConfig = async (
  workspaceRoot: string,
  requireExisting: boolean
): Promise<
  | { readonly ok: true; readonly data: WorkspaceConfig | undefined }
  | { readonly ok: false; readonly error: ToolError }
> => {
  const path = resolve(workspaceRoot, ".logbook/config.json")
  const text = await readOptionalText(path, ".logbook/config.json", MAX_WORKSPACE_CONFIG_BYTES)
  if (!text.ok) {
    return text
  }
  if (text.data === undefined) {
    if (!requireExisting) {
      return { ok: true, data: undefined }
    }
    return {
      ok: false,
      error: workspaceError("Workspace config does not exist. Run logbook workspace:init first.", {
        path: ".logbook/config.json",
      }),
    }
  }

  try {
    const parsed = JSON.parse(text.data) as unknown
    return { ok: true, data: isRecord(parsed) ? parsed : undefined }
  } catch {
    return {
      ok: false,
      error: workspaceError("Workspace config is not valid JSON.", {
        path: ".logbook/config.json",
      }),
    }
  }
}

const parseLinearConfig = (linear: Record<string, unknown>): LinearWorkspaceConfig => ({
  apiTokenEnv:
    typeof linear.apiTokenEnv === "string" && linear.apiTokenEnv.length > 0
      ? linear.apiTokenEnv
      : DEFAULT_LINEAR_API_TOKEN_ENV,
  ...(typeof linear.workspaceId === "string" && linear.workspaceId.length > 0
    ? { workspaceId: linear.workspaceId }
    : {}),
  ...(typeof linear.defaultTeamId === "string" && linear.defaultTeamId.length > 0
    ? { defaultTeamId: linear.defaultTeamId }
    : {}),
  ...(typeof linear.defaultProjectId === "string" && linear.defaultProjectId.length > 0
    ? { defaultProjectId: linear.defaultProjectId }
    : {}),
  ...(isRecord(linear.statusMapping)
    ? {
        statusMapping: {
          ...(isRecord(linear.statusMapping.linearStateTypeToTaskStatus)
            ? {
                linearStateTypeToTaskStatus: linear.statusMapping
                  .linearStateTypeToTaskStatus as Record<string, Task["status"]>,
              }
            : {}),
          ...(isRecord(linear.statusMapping.linearStateIdToTaskStatus)
            ? {
                linearStateIdToTaskStatus: linear.statusMapping.linearStateIdToTaskStatus as Record<
                  string,
                  Task["status"]
                >,
              }
            : {}),
          ...(isRecord(linear.statusMapping.taskStatusToLinearStateId)
            ? {
                taskStatusToLinearStateId: linear.statusMapping.taskStatusToLinearStateId as Record<
                  Task["status"],
                  string
                >,
              }
            : {}),
        },
      }
    : {}),
  ...(isRecord(linear.labelMapping) && isRecord(linear.labelMapping.labelNameToTopic)
    ? {
        labelMapping: {
          labelNameToTopic: linear.labelMapping.labelNameToTopic as Record<string, string>,
        },
      }
    : {}),
})

const readOptionalText = async (
  path: string,
  relativePath: string,
  maxBytes: number
): Promise<
  | { readonly ok: true; readonly data: string | undefined }
  | { readonly ok: false; readonly error: ToolError }
> => {
  const existing = await stat(path).catch((cause: unknown) => {
    if (isEnoent(cause)) {
      return null
    }
    throw cause
  })
  if (existing === null) {
    return { ok: true, data: undefined }
  }
  if (!existing.isFile()) {
    return {
      ok: false,
      error: workspaceError("Workspace path is incompatible with the v2 layout.", {
        path: relativePath,
        expected: "file",
      }),
    }
  }
  if (existing.size > maxBytes) {
    return {
      ok: false,
      error: workspaceError(`${relativePath} exceeds ${maxBytes} bytes.`, {
        path: relativePath,
        actualBytes: existing.size,
        maxBytes,
      }),
    }
  }
  const content = await readFile(path, "utf8")
  if (byteLength(content) > maxBytes) {
    return {
      ok: false,
      error: workspaceError(`${relativePath} exceeds ${maxBytes} bytes.`, {
        path: relativePath,
        actualBytes: byteLength(content),
        maxBytes,
      }),
    }
  }
  return { ok: true, data: content }
}

const readDotenvSync = (path: string): Record<string, string> => {
  try {
    const text = readFileSync(path, "utf8")
    if (byteLength(text) > MAX_DOTENV_BYTES) {
      return {}
    }
    return parseDotenv(text)
  } catch {
    return {}
  }
}

const parseDotenv = (content: string): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) {
      continue
    }
    const index = line.indexOf("=")
    if (index <= 0) {
      continue
    }
    const key = line.slice(0, index).trim()
    const rawValue = line.slice(index + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }
    values[key] = unquoteDotenvValue(rawValue)
  }
  return values
}

const unquoteDotenvValue = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

const byteLength = (value: string): number => textEncoder.encode(value).length

const isEnoent = (error: unknown): boolean => isRecord(error) && error.code === "ENOENT"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const workspaceError = (message: string, details?: Record<string, unknown>): ToolError => ({
  code: "workspace_error",
  message,
  ...(details === undefined ? {} : { details }),
})
