import type { RunCliOptions } from "./cli-adapter.js"
import { LOGBOOK_CLI_HELP, LOGBOOK_VERSION, runCli } from "./cli-adapter.js"
import { runInitOnboarding } from "./init-onboarding.js"
import { makeLogbookLayer } from "./layers.js"
import { runMcpStdio } from "./mcp-stdio.js"

const workspaceRoot = process.env.LOGBOOK_WORKSPACE_ROOT ?? process.cwd()
const layer = makeLogbookLayer(workspaceRoot) as unknown as RunCliOptions["layer"]
const argv = process.argv.slice(2)

if (argv[0] === "mcp") {
  runMcpStdio()
} else if (argv[0] === "init") {
  const exitCode = await runInitOnboarding(argv.slice(1))
  process.exit(exitCode)
} else if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  process.stdout.write(LOGBOOK_CLI_HELP)
  process.exit(0)
} else if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
  process.stdout.write(`${LOGBOOK_VERSION}\n`)
  process.exit(0)
} else {
  const chunks: Buffer[] = []
  process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk))
  process.stdin.on("end", async () => {
    const stdin = Buffer.concat(chunks).toString("utf8")
    const exitCode = await runCli(argv, { stdin, layer })
    process.exit(exitCode)
  })

  if (process.stdin.readableEnded) {
    const exitCode = await runCli(argv, { stdin: "", layer })
    process.exit(exitCode)
  }
}
