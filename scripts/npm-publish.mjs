import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const result = spawnSync("npm", ["publish", "--access", "public"], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_cache: join(tmpdir(), "logbook-npm-cache"),
  },
})

process.exit(result.status ?? 1)
