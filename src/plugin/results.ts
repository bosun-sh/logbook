import type { OhtoolsError, ValidationError } from "@bosun-sh/ohtools"
import type { ToolResult } from "@logbook/shared/result.js"

type ToolWarning = NonNullable<Extract<ToolResult<never>, { ok: true }>["warnings"]>[number]
type ToolError = Extract<ToolResult<never>, { ok: false }>["error"]

const MAX_WARNING_COUNT = 20
const MAX_ERROR_DETAIL_BYTES = 65_536
const textEncoder = new TextEncoder()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isToolResult = <T>(value: unknown): value is ToolResult<T> =>
  (isRecord(value) && value.ok === true && Object.hasOwn(value, "data")) ||
  (isRecord(value) &&
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string")

const isOhtoolsValidationError = (value: unknown): value is ValidationError =>
  isRecord(value) &&
  value.code === "OHTOOLS_VALIDATION_ERROR" &&
  Array.isArray(value.issues) &&
  typeof value.message === "string"

const isOhtoolsError = (value: unknown): value is OhtoolsError =>
  isRecord(value) && typeof value.code === "string" && typeof value.message === "string"

const normalizeWarnings = (warnings: readonly ToolWarning[]): ToolWarning[] | undefined => {
  if (warnings.length === 0) {
    return undefined
  }

  if (warnings.length <= MAX_WARNING_COUNT) {
    return [...warnings]
  }

  return [
    ...warnings.slice(0, MAX_WARNING_COUNT - 1),
    {
      code: "result_truncated",
      message: "Warnings exceeded the public result limit",
      details: {
        originalCount: warnings.length,
        returnedCount: MAX_WARNING_COUNT,
      },
    },
  ]
}

const truncateErrorDetails = (
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (details === undefined) {
    return undefined
  }

  const serialized = JSON.stringify(details)
  if (serialized === undefined) {
    return {
      truncated: true,
      maxBytes: MAX_ERROR_DETAIL_BYTES,
    }
  }

  if (textEncoder.encode(serialized).length <= MAX_ERROR_DETAIL_BYTES) {
    return details
  }

  return {
    truncated: true,
    maxBytes: MAX_ERROR_DETAIL_BYTES,
  }
}

const normalizeToolError = (error: ToolError): ToolError => {
  const details = error.details === undefined ? undefined : truncateErrorDetails(error.details)

  return {
    code: error.code,
    message: error.message,
    ...(details === undefined ? {} : { details }),
  }
}

export const toToolResult = <T>(
  output: T | ToolResult<T> | OhtoolsError,
  warnings: readonly ToolWarning[] = []
): ToolResult<T> => {
  if (isToolResult<T>(output)) {
    if (!output.ok) {
      return {
        ok: false,
        error: normalizeToolError(output.error),
      }
    }

    const normalizedWarnings = normalizeWarnings([...(output.warnings ?? []), ...warnings])
    return {
      ok: true,
      data: output.data,
      ...(normalizedWarnings === undefined ? {} : { warnings: normalizedWarnings }),
    }
  }

  if (isOhtoolsValidationError(output)) {
    const details = truncateErrorDetails({
      issues: output.issues,
      ...(output.path === undefined ? {} : { path: output.path }),
    })

    return {
      ok: false,
      error: {
        code: "schema_validation_error",
        message: output.message,
        ...(details === undefined ? {} : { details }),
      },
    }
  }

  if (isOhtoolsError(output)) {
    const details =
      output.path === undefined && output.metadata === undefined
        ? undefined
        : truncateErrorDetails({
            ...(output.path === undefined ? {} : { path: output.path }),
            ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
          })

    return {
      ok: false,
      error: {
        code: "adapter_error",
        message: output.message,
        ...(details === undefined ? {} : { details }),
      },
    }
  }

  const normalizedWarnings = normalizeWarnings(warnings)
  return {
    ok: true,
    data: output,
    ...(normalizedWarnings === undefined ? {} : { warnings: normalizedWarnings }),
  }
}
