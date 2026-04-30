#!/usr/bin/env node
const { spawnSync } = require("node:child_process")
const { existsSync } = require("node:fs")
const path = require("node:path")

const platformMap = {
  darwin: {
    arm64: "darwin-arm64",
    x64: "darwin-x64",
  },
  linux: {
    arm64: "linux-arm64",
    x64: "linux-x64",
  },
  win32: {
    arm64: "win32-arm64",
    x64: "win32-x64",
  },
}

const resolveBinary = () => {
  const platform = platformMap[process.platform]?.[process.arch]
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`)
  }
  const ext = process.platform === "win32" ? ".exe" : ""
  return path.join(__dirname, "..", "dist", "bin", platform, `logbook-mcp${ext}`)
}

const binary = resolveBinary()
if (!existsSync(binary)) {
  console.error(
    `logbook-mcp binary not found at ${binary}. Reinstall the package or run the build step before publishing.`
  )
  process.exit(1)
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" })
if (result.error) {
  throw result.error
}
process.exit(result.status ?? 0)
