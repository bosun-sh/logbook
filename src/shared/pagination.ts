import type { ToolResult } from "./result.js"

export type PageCursor = string

type CursorPayload = {
  readonly kind: string
  readonly lastId: string
  readonly lastSort: readonly unknown[]
  readonly providerCursor?: string
}

type SortValueKind = "string" | "number" | "boolean" | "null"

type DecodeOptions = {
  readonly kind: string
  readonly sortShape: readonly SortValueKind[]
}

const MAX_CURSOR_BYTES = 2_048

const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const sortValueKind = (value: unknown): SortValueKind | "object" | "undefined" => {
  if (value === null) {
    return "null"
  }

  switch (typeof value) {
    case "string":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "undefined":
      return "undefined"
    default:
      return "object"
  }
}

const assertCursorPayload = (value: unknown, options: DecodeOptions): ToolResult<CursorPayload> => {
  if (!isRecord(value)) {
    return validationError("cursor payload must be an object")
  }

  if (typeof value.kind !== "string" || typeof value.lastId !== "string") {
    return validationError("cursor payload is missing required fields")
  }

  if (!Array.isArray(value.lastSort)) {
    return validationError("cursor payload lastSort must be an array")
  }

  if (value.kind !== options.kind) {
    return validationError("cursor kind does not match operation", {
      expected: options.kind,
      actual: value.kind,
    })
  }

  if (value.lastSort.length !== options.sortShape.length) {
    return validationError("cursor sort shape does not match operation", {
      expected: options.sortShape,
      actualLength: value.lastSort.length,
    })
  }

  for (let index = 0; index < options.sortShape.length; index += 1) {
    const actual = sortValueKind(value.lastSort[index])
    const expected = options.sortShape[index]
    if (actual !== expected) {
      return validationError("cursor sort shape does not match operation", {
        index,
        expected,
        actual,
      })
    }
  }

  if (
    Object.hasOwn(value, "providerCursor") &&
    typeof value.providerCursor !== "undefined" &&
    typeof value.providerCursor !== "string"
  ) {
    return validationError("cursor providerCursor must be a string")
  }

  return {
    ok: true,
    data: {
      kind: value.kind,
      lastId: value.lastId,
      lastSort: value.lastSort,
      ...(typeof value.providerCursor === "string" ? { providerCursor: value.providerCursor } : {}),
    },
  }
}

export const PageCursor = {
  encode(payload: CursorPayload): ToolResult<PageCursor> {
    const json = JSON.stringify(payload)
    const encoded = Buffer.from(json, "utf8").toString("base64url")

    if (Buffer.byteLength(encoded, "utf8") > MAX_CURSOR_BYTES) {
      return validationError("cursor exceeds maximum encoded size", {
        maxBytes: MAX_CURSOR_BYTES,
      })
    }

    return {
      ok: true,
      data: encoded,
    }
  },

  decode(cursor: PageCursor, options: DecodeOptions): ToolResult<CursorPayload> {
    if (Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES) {
      return validationError("cursor exceeds maximum encoded size", {
        maxBytes: MAX_CURSOR_BYTES,
      })
    }

    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      return validationError("cursor must be base64url encoded")
    }

    let parsed: unknown
    try {
      const json = Buffer.from(cursor, "base64url").toString("utf8")
      parsed = JSON.parse(json)
    } catch {
      return validationError("cursor must decode to JSON")
    }

    return assertCursorPayload(parsed, options)
  },
} as const
