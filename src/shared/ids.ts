const ID_SUFFIX_PATTERN = /^[0-9a-f]{32}$/i

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const createId = (kind: string): string => `${kind}_${crypto.randomUUID().replace(/-/g, "")}`

export const parseId = (kind: string, value: string): string | null => {
  const prefix = `${kind}_`
  if (!value.startsWith(prefix)) {
    return null
  }

  const suffix = value.slice(prefix.length)
  if (suffix.length === 0 || !ID_SUFFIX_PATTERN.test(suffix)) {
    return null
  }

  return new RegExp(`^${escapeRegExp(kind)}_[0-9a-f]{32}$`, "i").test(value) ? value : null
}
