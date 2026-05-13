import { makeLogbookLayer } from "./layers.js"
import type { CreateMcpServerOptions } from "./mcp-server.js"
import { createMcpServer } from "./mcp-server.js"

const MAX_LINE_BYTES = 1_048_576
const textEncoder = new TextEncoder()

const sendResponse = (id: unknown, result: unknown): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
}

const sendError = (id: unknown, code: number, message: string): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const runMcpStdio = (): void => {
  const workspaceRoot = process.env.LOGBOOK_WORKSPACE_ROOT ?? process.cwd()
  const layer = makeLogbookLayer(workspaceRoot) as unknown as CreateMcpServerOptions["layer"]
  const server = createMcpServer({ layer, workspaceRoot })

  const handleLine = async (line: string): Promise<void> => {
    if (textEncoder.encode(line).length > MAX_LINE_BYTES) {
      sendError(null, -32700, "Parse error: line exceeds 1 MiB limit.")
      return
    }

    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      sendError(null, -32700, "Parse error: invalid JSON.")
      return
    }

    if (!isRecord(message)) {
      sendError(null, -32600, "Invalid Request: must be a JSON object.")
      return
    }

    const id = message.id ?? null
    const method = message.method
    if (typeof method !== "string") {
      sendError(id, -32600, "Invalid Request: missing method.")
      return
    }

    const params = message.params ?? {}
    try {
      const result = await server.dispatch(method, params)
      sendResponse(id, result)
    } catch (cause) {
      sendError(id, -32603, `Internal error: ${String(cause)}`)
    }
  }

  let buffer = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim().length > 0) {
        void handleLine(line)
      }
    }
  })
  process.stdin.on("end", () => {
    if (buffer.trim().length > 0) {
      void handleLine(buffer)
    }
  })
}
