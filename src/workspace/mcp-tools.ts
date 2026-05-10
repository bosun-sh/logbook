import type { JsonSchema, RuntimeOptions } from "@bosun-sh/ohtools"
import { publicToolSchemas } from "@logbook/plugin/public-schemas.js"
import { createLogbookApp } from "./ohtools-app.js"

export type McpToolDescriptor = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
}

type McpToolRegistryOptions = {
  readonly layer?: RuntimeOptions["layer"] | undefined
}

type PublicToolId = keyof typeof publicToolSchemas

const hasPublicSchema = (toolId: string): toolId is PublicToolId =>
  Object.hasOwn(publicToolSchemas, toolId)

const buildMcpToolDescriptors = (): readonly McpToolDescriptor[] => {
  const registry = createLogbookApp().build()
  return [...registry.tools.values()]
    .flatMap((tool) => {
      if (!hasPublicSchema(tool.id)) {
        return []
      }

      return [
        {
          name: tool.id,
          description: tool.description,
          inputSchema: publicToolSchemas[tool.id].jsonSchema ?? {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ]
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

const descriptors = buildMcpToolDescriptors()
const descriptorByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]))

export const mcpToolRegistry = {
  listTools(): readonly McpToolDescriptor[] {
    return descriptors
  },

  getTool(name: string): McpToolDescriptor | undefined {
    return descriptorByName.get(name)
  },

  hasTool(name: string): boolean {
    return descriptorByName.has(name)
  },

  runtime(options: McpToolRegistryOptions = {}) {
    const app = createLogbookApp()
    const runtimeOptions: RuntimeOptions =
      options.layer === undefined ? {} : { layer: options.layer }
    return app.runtime(runtimeOptions)
  },
} as const
