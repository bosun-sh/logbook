import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const result = spawnSync("npm", ["pack", "--dry-run"], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_cache: join(tmpdir(), "logbook-npm-cache"),
  },
})

process.exit(result.status ?? 1)
