import { registerLogbookTools } from "@logbook/plugin/tool-registry.js"
import { v1CliAliases } from "./v1-cli-aliases.js"

type CliCommand = {
  readonly alias: string
  readonly toolId: string
  readonly compatibility?: "v1" | undefined
}

const registry = registerLogbookTools()

const colonCommands = registry.toolIds.map((toolId) => ({
  alias: toolId.replaceAll(".", ":"),
  toolId,
}))

export const cliCommands = Object.freeze([
  ...colonCommands,
  ...v1CliAliases,
]) satisfies readonly CliCommand[]

export type { CliCommand }
