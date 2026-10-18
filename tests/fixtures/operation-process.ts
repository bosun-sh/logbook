import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { type RunCliOptions, runCli } from "../../src/workspace/cli-adapter.js"
import { makeLogbookLayer } from "../../src/workspace/layers.js"
import { type CreateMcpServerOptions, createMcpServer } from "../../src/workspace/mcp-server.js"

const [root, tool, json, stop, action, surface] = process.argv.slice(2) as string[]
if (!root || !tool || !json) throw new Error("Missing fixture arguments")
const layer = makeLogbookLayer(root, async (point) => {
  if (point !== stop) return
  if (action === "kill") process.kill(process.pid, "SIGKILL")
  if (action === "readonly") await chmod(join(root, ".logbook/storage"), 0o555)
  if (action === "hold") {
    process.stdout.write("locked\n")
    await new Promise<void>(() => {})
  }
})
if (surface === "mcp") {
  const server = createMcpServer({
    workspaceRoot: root,
    layer: layer as unknown as CreateMcpServerOptions["layer"],
  })
  const response = await server.callTool({
    name: tool.replaceAll(":", "."),
    arguments: JSON.parse(json),
  })
  process.stdout.write(`${response.content[0].text}\n`)
} else {
  process.exitCode = await runCli([tool], {
    stdin: json,
    layer: layer as unknown as RunCliOptions["layer"],
  })
}
