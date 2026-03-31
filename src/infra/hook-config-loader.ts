import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import type { HookConfig } from "../hook/hook-executor.js"
import { logger } from "./logger.js"

const KNOWN_KEYS = ["event", "condition", "timeout_ms"] as const

const HookConfigFileSchema = z.object({
  event: z.string(),
  condition: z.string().optional(),
  timeout_ms: z.number().optional(),
})

/**
 * Parses a strict subset of YAML: flat key-value pairs, no nesting.
 * Supports quoted strings and bare integers.
 */
const parseSimpleYaml = (content: string): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value: unknown = trimmed.slice(colonIdx + 1).trim()
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    } else if (typeof value === "string" && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    } else if (typeof value === "string" && /^\d+$/.test(value)) {
      value = parseInt(value, 10)
    }
    result[key] = value
  }
  return result
}

const SCRIPT_CANDIDATES = ["script.ts", "script.sh"] as const

const findScript = async (hookDir: string): Promise<string | undefined> => {
  for (const name of SCRIPT_CANDIDATES) {
    const candidate = join(hookDir, name)
    try {
      await readFile(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return undefined
}

export const loadHookConfigs = async (hooksDir: string): Promise<HookConfig[]> => {
  let entries: string[]
  try {
    entries = await readdir(hooksDir)
  } catch (e: unknown) {
    if (isEnoent(e)) return []
    throw e
  }

  const configs: HookConfig[] = []

  for (const entry of entries) {
    const hookDir = join(hooksDir, entry)
    try {
      const configPath = join(hookDir, "config.yml")
      const raw = await readFile(configPath, "utf8")
      const parsed = parseSimpleYaml(raw)
      const validated = HookConfigFileSchema.safeParse(parsed)
      if (!validated.success) {
        logger.warn("invalid hook config", { path: configPath, error: validated.error.message })
        continue
      }
      // Warn on unrecognized keys
      const parsedKeys = Object.keys(parsed)
      for (const key of parsedKeys) {
        if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
          const validKeysStr = KNOWN_KEYS.join(", ")
          logger.warn("unrecognized key in hook config", {
            hook: entry,
            key,
            validKeys: validKeysStr,
          })
        }
      }
      const script = await findScript(hookDir)
      if (script === undefined) {
        logger.warn("no script found in hook dir, skipping", { path: hookDir })
        continue
      }
      const { event, condition, timeout_ms } = validated.data
      const config: HookConfig = {
        event,
        script,
        ...(condition !== undefined ? { condition } : {}),
        ...(timeout_ms !== undefined ? { timeout_ms } : {}),
      }
      configs.push(config)
    } catch (e: unknown) {
      logger.warn("failed to load hook", { hook: entry, error: String(e) })
    }
  }

  return configs
}

const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT"
