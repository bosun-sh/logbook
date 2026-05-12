import { cpSync } from "node:fs"

cpSync("src/workspace/hook-templates", "dist/workspace/hook-templates", {
  recursive: true,
})
