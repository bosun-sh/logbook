type ToolWarning = {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

type ToolError = {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

const MAX_WARNING_COUNT = 20
const MAX_ERROR_DETAIL_BYTES = 65_536

export type ToolResult<T> =
  | {
      readonly ok: true
      readonly data: T
      readonly warnings?: ToolWarning[]
    }
  | {
      readonly ok: false
      readonly error: ToolError
    }

void MAX_WARNING_COUNT
void MAX_ERROR_DETAIL_BYTES
