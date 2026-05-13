import { type PageCursor as EncodedPageCursor, PageCursor } from "@logbook/shared/pagination.js"
import type { ToolResult } from "@logbook/shared/result.js"
import type { RegisteredLogbookTools, RegisteredPluginMetadata } from "./tool-registry.js"

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100

export type ListPluginsInput = {
  readonly limit?: number | undefined
  readonly cursor?: EncodedPageCursor | undefined
}

type ListPluginsResult = {
  readonly items: readonly RegisteredPluginMetadata[]
  readonly hasMore: boolean
  readonly nextCursor?: EncodedPageCursor | undefined
}

export const listPlugins = (
  input: ListPluginsInput,
  registry: RegisteredLogbookTools
): ToolResult<ListPluginsResult> => {
  const afterCursor = sliceAfterCursor(registry.metadata, input.cursor)
  if (!afterCursor.ok) {
    return afterCursor
  }

  const limit = normalizeLimit(input.limit)
  const items = afterCursor.data.slice(0, limit)
  const hasMore = afterCursor.data.length > items.length
  if (!hasMore) {
    return {
      ok: true,
      data: {
        items,
        hasMore: false,
      },
    }
  }

  const last = items[items.length - 1]
  if (last === undefined) {
    return {
      ok: true,
      data: {
        items,
        hasMore: false,
      },
    }
  }

  const nextCursor = PageCursor.encode({
    kind: "plugin.list",
    lastId: last.id,
    lastSort: [last.id],
  })
  if (!nextCursor.ok) {
    return nextCursor
  }

  return {
    ok: true,
    data: {
      items,
      hasMore: true,
      nextCursor: nextCursor.data,
    },
    warnings: [
      {
        code: "has_more",
        message: "Additional records are available through a cursor",
        details: { cursor: nextCursor.data },
      },
    ],
  }
}

const normalizeLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_LIMIT
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIMIT
  }

  return Math.min(limit, MAX_LIMIT)
}

const sliceAfterCursor = (
  items: readonly RegisteredPluginMetadata[],
  cursor: EncodedPageCursor | undefined
): ToolResult<readonly RegisteredPluginMetadata[]> => {
  if (cursor === undefined) {
    return { ok: true, data: items }
  }

  const decoded = PageCursor.decode(cursor, {
    kind: "plugin.list",
    sortShape: ["string"],
  })
  if (!decoded.ok) {
    return decoded
  }

  const [id] = decoded.data.lastSort as [string]
  return {
    ok: true,
    data: items.filter((item) => comparePluginToCursor(item, id, decoded.data.lastId) > 0),
  }
}

const comparePluginToCursor = (
  item: RegisteredPluginMetadata,
  sortId: string,
  id: string
): number => {
  if (item.id !== sortId) {
    return item.id.localeCompare(sortId)
  }

  return item.id.localeCompare(id)
}
