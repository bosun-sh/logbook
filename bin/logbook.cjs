#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const { existsSync } = require("node:fs")
const path = require("node:path")

const entry = path.join(__dirname, "..", "dist", "workspace", "bin-cli.js")
if (!existsSync(entry)) {
  console.error(
    `logbook entrypoint not found at ${entry}. Reinstall the package or run the build step before publishing.`
  )
  process.exit(1)
}

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: "inherit" })
if (result.error) {
  throw result.error
}
process.exit(result.status ?? 0)
