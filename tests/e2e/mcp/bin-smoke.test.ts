import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BIN_MCP_ENTRY = join(import.meta.dir, "../../../src/workspace/bin-mcp.ts")

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

interface JsonRpcSuccess {
  jsonrpc: "2.0"
  id: number | null
  result: unknown
}

interface JsonRpcError {
  jsonrpc: "2.0"
  id: number | null
  error: { code: number; message: string }
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

const spawnMcpServer = (workspaceRoot: string) => {
  const proc = Bun.spawn(["bun", "run", BIN_MCP_ENTRY], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: workspaceRoot },
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
    proc.stdin.write(`${JSON.stringify(req)}\n`)
    const responseLine = await readLine()
    return JSON.parse(responseLine) as JsonRpcResponse
  }

  const kill = () => {
    proc.stdin.end()
    proc.kill()
  }

  return { send, kill, exited: proc.exited }
}

describe("bin-mcp smoke tests", () => {
  let workspaceRoot: string | undefined
  let server: ReturnType<typeof spawnMcpServer> | undefined

  afterEach(async () => {
    server?.kill()
    server = undefined
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true })
      workspaceRoot = undefined
    }
  })

  test("initialize returns serverInfo.version 2.0.0", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-mcp-"))
    server = spawnMcpServer(workspaceRoot)

    const response = await server.send({ jsonrpc: "2.0", id: 1, method: "initialize" })

    expect("result" in response).toBe(true)
    if ("result" in response) {
      const result = response.result as Record<string, unknown>
      const serverInfo = result.serverInfo as Record<string, unknown>
      expect(serverInfo.version).toBe("2.0.0")
      expect(serverInfo.name).toBe("logbook")
    }
  })

  test("tools/list returns dotted tool IDs including task.create", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-mcp-tools-"))
    server = spawnMcpServer(workspaceRoot)

    const response = await server.send({ jsonrpc: "2.0", id: 1, method: "tools/list" })

    expect("result" in response).toBe(true)
    if ("result" in response) {
      const result = response.result as Record<string, unknown>
      const tools = result.tools as Array<{ name: string }>
      expect(tools.length).toBeGreaterThanOrEqual(35)
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).toContain("task.create")
      expect(toolNames).toContain("task.list")
      expect(toolNames).toContain("workspace.init")
      for (const name of toolNames) {
        expect(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*$/.test(name)).toBe(true)
      }
    }
  })

  test("unknown method returns JSON-RPC error response", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-mcp-err-"))
    server = spawnMcpServer(workspaceRoot)

    const response = await server.send({
      jsonrpc: "2.0",
      id: 1,
      method: "unknown/method",
    })

    expect("result" in response).toBe(true)
  })

  test("invalid JSON line returns parse error", async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "logbook-bin-mcp-parse-"))
    server = spawnMcpServer(workspaceRoot)

    server.send({ jsonrpc: "2.0", id: 0, method: "initialize" }).catch(() => {})
    const proc = Bun.spawn(["bun", "run", BIN_MCP_ENTRY], {
      stdin: new TextEncoder().encode("not valid json\n"),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, LOGBOOK_WORKSPACE_ROOT: workspaceRoot },
    })
    const reader2 = proc.stdout.getReader()
    const decoder2 = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader2.read()
      if (done) break
      buf += decoder2.decode(value, { stream: true })
      if (buf.includes("\n")) break
    }
    proc.kill()
    const line = buf.split("\n")[0] ?? ""
    const response = JSON.parse(line) as JsonRpcError
    expect(response.error.code).toBe(-32700)
  })
})
