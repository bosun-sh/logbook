import { Effect } from "effect"
import { describe, test, expect, afterEach } from "bun:test"
import { executeHooks, type HookConfig } from "@logbook/hook/hook-executor.js"
import { createTempJsonl, type TempJsonl } from "../../helpers/temp-jsonl.js"
import { makeComment } from "../../helpers/factories.js"
import { existsSync, readFileSync } from "node:fs"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, never>)

const baseEvent = {
  task_id:    "t-1",
  old_status: 'in_progress' as const,
  new_status: 'need_info' as const,
  comment:    makeComment({ id: "c-1", kind: 'need_info' }),
  session_id: "s-1",
}

let tmp: TempJsonl

afterEach(async () => { await tmp?.cleanup() })

describe("hook-executor", () => {
  test("hook with matching condition fires", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [{
      event:     "task.status_changed",
      condition: "new_status == 'need_info'",
      script:    `touch ${tmp.path}.marker`,
    }]
    await run(executeHooks(baseEvent, configs))
    expect(existsSync(`${tmp.path}.marker`)).toBe(true)
  })

  test("hook with non-matching condition does not fire", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [{
      event:     "task.status_changed",
      condition: "new_status == 'done'",
      script:    `touch ${tmp.path}.marker`,
    }]
    await run(executeHooks(baseEvent, configs))
    expect(existsSync(`${tmp.path}.marker`)).toBe(false)
  })

  test("hook with no condition fires every time", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [{
      event:  "task.status_changed",
      script: `touch ${tmp.path}.marker`,
    }]
    await run(executeHooks(baseEvent, configs))
    expect(existsSync(`${tmp.path}.marker`)).toBe(true)
  })

  test("two hooks on same event both fire", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [
      { event: "task.status_changed", script: `touch ${tmp.path}.a` },
      { event: "task.status_changed", script: `touch ${tmp.path}.b` },
    ]
    await run(executeHooks(baseEvent, configs))
    expect(existsSync(`${tmp.path}.a`)).toBe(true)
    expect(existsSync(`${tmp.path}.b`)).toBe(true)
  })

  test("hook exceeding timeout_ms is terminated; executeHooks still returns succeed", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [{
      event:      "task.status_changed",
      timeout_ms: 50,
      script:     `sleep 999 && touch ${tmp.path}.marker`,
    }]
    // Must not throw — Effect<void, never>
    await run(executeHooks(baseEvent, configs))
    expect(existsSync(`${tmp.path}.marker`)).toBe(false)
  })

  test("hook context passes task_id, old_status, new_status to script", async () => {
    tmp = await createTempJsonl()
    const configs: HookConfig[] = [{
      event:  "task.status_changed",
      // Context is passed as env vars LOGBOOK_TASK_ID, LOGBOOK_OLD_STATUS, LOGBOOK_NEW_STATUS
      script: `echo "$LOGBOOK_TASK_ID $LOGBOOK_OLD_STATUS $LOGBOOK_NEW_STATUS" > ${tmp.path}.ctx`,
    }]
    await run(executeHooks(baseEvent, configs))
    const content = readFileSync(`${tmp.path}.ctx`, "utf8").trim()
    expect(content).toBe("t-1 in_progress need_info")
  })
})
