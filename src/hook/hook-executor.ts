import { Effect } from "effect"
import type { HookEvent } from "./ports.js"

export interface HookConfig {
  event:       string
  condition?:  string
  timeout_ms?: number
  script:      string
}

const HOOK_EVENT_NAME = "task.status_changed"
const DEFAULT_TIMEOUT_MS = 5000

const evaluateCondition = (condition: string, event: HookEvent): boolean => {
  try {
    const fn = new Function(
      "new_status", "old_status", "task_id", "session_id",
      `return (${condition})`,
    )
    return Boolean(fn(event.new_status, event.old_status, event.task_id, event.session_id))
  } catch {
    return false
  }
}

const runScript = (config: HookConfig, event: HookEvent): Promise<void> =>
  new Promise((resolve) => {
    const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS

    const cmd = config.script.endsWith(".ts")
      ? ["bun", config.script]
      : ["sh", "-c", config.script]

    const child = Bun.spawn(cmd, {
      env: {
        ...process.env,
        LOGBOOK_TASK_ID:    event.task_id,
        LOGBOOK_OLD_STATUS: event.old_status,
        LOGBOOK_NEW_STATUS: event.new_status,
        LOGBOOK_SESSION_ID: event.session_id,
      },
    })

    const timer = setTimeout(() => { child.kill() }, timeoutMs)

    child.exited.then(() => {
      clearTimeout(timer)
      resolve()
    }).catch(() => {
      clearTimeout(timer)
      resolve()
    })
  })

export const executeHooks = (
  event: HookEvent,
  configs: readonly HookConfig[],
): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    await Promise.all(
      configs
        .filter(c => c.event === HOOK_EVENT_NAME)
        .filter(c => !c.condition || evaluateCondition(c.condition, event))
        .map(c => runScript(c, event)),
    )
  })
