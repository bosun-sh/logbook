import type { OhtoolsPlugin } from "@bosun-sh/ohtools"
import { registerLogbookTools } from "./tool-registry.js"

export const logbookPlugins = Object.freeze(
  registerLogbookTools().plugins
) satisfies readonly OhtoolsPlugin[]
