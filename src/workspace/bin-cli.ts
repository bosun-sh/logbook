import type { RunCliOptions } from "./cli-adapter.js"
import { runCli } from "./cli-adapter.js"
import { makeLogbookLayer } from "./layers.js"

const workspaceRoot = process.env.LOGBOOK_WORKSPACE_ROOT ?? process.cwd()
const layer = makeLogbookLayer(workspaceRoot) as unknown as RunCliOptions["layer"]

const chunks: Buffer[] = []
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk))
process.stdin.on("end", async () => {
  const stdin = Buffer.concat(chunks).toString("utf8")
  const exitCode = await runCli(process.argv.slice(2), { stdin, layer })
  process.exit(exitCode)
})

if (process.stdin.readableEnded) {
  const exitCode = await runCli(process.argv.slice(2), { stdin: "", layer })
  process.exit(exitCode)
}
