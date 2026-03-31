type Level = "debug" | "info" | "warn" | "error"
type LogContext = Record<string, unknown>

interface Logger {
  debug(msg: string, ctx?: LogContext): void
  info(msg: string, ctx?: LogContext): void
  warn(msg: string, ctx?: LogContext): void
  error(msg: string, ctx?: LogContext): void
}

const LEVEL_ORDER: readonly Level[] = ["debug", "info", "warn", "error"]

const levelIndex = (level: Level): number => LEVEL_ORDER.indexOf(level)

const makeLogger = (threshold: Level): Logger => {
  const thresholdIdx = levelIndex(threshold)

  const log = (level: Level, msg: string, ctx?: LogContext): void => {
    if (levelIndex(level) < thresholdIdx) return
    const entry = { level, ts: new Date().toISOString(), msg, ...ctx }
    process.stderr.write(`${JSON.stringify(entry)}\n`)
  }

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
  }
}

const resolveThreshold = (): Level => {
  const raw = process.env.LOGBOOK_LOG_LEVEL?.toLowerCase()
  if (raw !== undefined && (LEVEL_ORDER as readonly string[]).includes(raw)) {
    return raw as Level
  }
  return "warn"
}

export const logger: Logger = makeLogger(resolveThreshold())
