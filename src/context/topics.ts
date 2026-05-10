import type { ToolResult } from "@logbook/shared/result.js"

const textEncoder = new TextEncoder()
const MAX_TOPICS_PER_ENTRY = 50
const MAX_TOPIC_BYTES = 256

export const normalizeTopic = (topic: string): ToolResult<string> => {
  const normalized = topic.trim().replace(/\s+/g, " ").toLowerCase()
  if (normalized.length === 0) {
    return validationError("topic must not be empty", { field: "topic" })
  }

  if (byteLength(normalized) > MAX_TOPIC_BYTES) {
    return validationError(`topic exceeds ${MAX_TOPIC_BYTES} bytes`, {
      field: "topic",
      maxBytes: MAX_TOPIC_BYTES,
    })
  }

  return {
    ok: true,
    data: normalized,
  }
}

export const normalizeTopics = (
  topics: readonly string[] | undefined
): ToolResult<readonly string[]> => {
  const normalizedTopics: string[] = []
  const seen = new Set<string>()

  for (const topic of topics ?? []) {
    const normalized = normalizeTopic(topic)
    if (!normalized.ok) {
      return normalized
    }

    if (seen.has(normalized.data)) {
      continue
    }

    seen.add(normalized.data)
    normalizedTopics.push(normalized.data)
  }

  if (normalizedTopics.length > MAX_TOPICS_PER_ENTRY) {
    return validationError(`topics exceeds ${MAX_TOPICS_PER_ENTRY} items`, {
      field: "topics",
      maxItems: MAX_TOPICS_PER_ENTRY,
    })
  }

  return {
    ok: true,
    data: normalizedTopics,
  }
}

const byteLength = (value: string): number => textEncoder.encode(value).length

const validationError = (
  message: string,
  details?: Record<string, unknown>
): ToolResult<never> => ({
  ok: false,
  error: {
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details }),
  },
})
