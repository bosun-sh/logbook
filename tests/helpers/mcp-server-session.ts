import { join } from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0"
  id: number | null
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: "2.0"
  id: number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

export interface ServerSession {
  send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>
  sendRaw: (line: string) => Promise<JsonRpcResponse>
  kill: () => void
  /** Hard-kills the process without closing stdin (simulates a crash — no deregistration). */
  killHard: () => void
  exited: Promise<number>
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const SERVER_ENTRY = join(import.meta.dir, "../../src/mcp/server.ts")

export const spawnServer = (tasksFile: string, hooksDir: string): ServerSession => {
  const proc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LOGBOOK_TASKS_FILE: tasksFile,
      LOGBOOK_HOOKS_DIR: hooksDir,
    },
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const readLine = async (): Promise<string> => {
    while (true) {
      const newlineIdx = buffer.indexOf("\n")
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        return line
      }
      const { done, value } = await reader.read()
      if (done) throw new Error("Server stdout closed unexpectedly")
      buffer += decoder.decode(value, { stream: true })
    }
  }

  const send = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const line = `${JSON.stringify(req)}\n`
    proc.stdin.write(line)
    const responseLine = await readLine()
    return JSON.parse(responseLine) as JsonRpcResponse
  }

  const sendRaw = async (raw: string): Promise<JsonRpcResponse> => {
    proc.stdin.write(raw)
    const responseLine = await readLine()
    return JSON.parse(responseLine) as JsonRpcResponse
  }

  const kill = (): void => {
    proc.stdin.end()
    proc.kill()
  }

  const killHard = (): void => {
    proc.kill(9)
  }

  return { send, sendRaw, kill, killHard, exited: proc.exited }
}

export const isError = (r: JsonRpcResponse): r is JsonRpcError => "error" in r
export const isSuccess = (r: JsonRpcResponse): r is JsonRpcSuccess => "result" in r
