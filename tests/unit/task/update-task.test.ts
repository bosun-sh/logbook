import { beforeEach, describe, expect, test } from "bun:test"
import type { Status } from "@logbook/domain/types.js"
import { HookRunner } from "@logbook/hook/ports.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { updateTask } from "@logbook/task/update-task.js"
import { Effect, Layer } from "effect"
import { makeAgent, makeComment, makeTask } from "../../helpers/factories.js"
import { InMemoryTaskRepository } from "../../helpers/in-memory-task-repository.js"
import { SpyHookRunner } from "../../helpers/spy-hook-runner.js"

type AnyError = { _tag: string; [k: string]: unknown }

let repo: InMemoryTaskRepository
let spy: SpyHookRunner

const makeLayer = () =>
  Layer.merge(Layer.succeed(TaskRepository, repo), Layer.succeed(HookRunner, spy))

const run = <A>(effect: Effect.Effect<A, unknown, TaskRepository | HookRunner>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, makeLayer()) as Effect.Effect<A, never>)

const runFail = <A>(
  effect: Effect.Effect<A, unknown, TaskRepository | HookRunner>
): Promise<AnyError> =>
  Effect.runPromise(
    Effect.provide(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (e) => Effect.succeed(e as AnyError),
          onSuccess: () => Effect.die(new Error("Expected failure")),
        })
      ),
      makeLayer()
    ) as Effect.Effect<AnyError, never>
  )

const seedTask = async (overrides: Parameters<typeof makeTask>[0] = {}) => {
  const task = makeTask(overrides)
  await run(Effect.flatMap(TaskRepository, (r) => r.save(task)))
  return task
}

beforeEach(() => {
  repo = new InMemoryTaskRepository()
  spy = new SpyHookRunner()
})

// ──────────────────────────────────────────
// Valid transitions
// ──────────────────────────────────────────
describe("updateTask / valid transitions", () => {
  const valid: Array<[Status, Status]> = [
    ["backlog", "todo"],
    ["todo", "backlog"],
    ["todo", "in_progress"],
    ["in_progress", "todo"],
    ["in_progress", "pending_review"],
    ["in_progress", "need_info"],
    ["in_progress", "blocked"],
    ["blocked", "in_progress"],
    ["need_info", "in_progress"],
    ["pending_review", "done"],
    ["pending_review", "in_progress"],
  ]

  for (const [from, to] of valid) {
    test(`${from} → ${to}: status changes and hook fires`, async () => {
      const needsComment = to === "need_info" || to === "blocked"
      const task = await seedTask({
        status: from,
        in_progress_since: from === "in_progress" ? new Date() : undefined,
      })
      const comment = needsComment
        ? makeComment({ kind: to === "need_info" ? "need_info" : "regular", content: "reason" })
        : null
      // need_info→in_progress requires a replied-to comment
      if (from === "need_info") {
        const repliedComment = makeComment({
          kind: "need_info",
          reply: "answered",
          content: "question",
        })
        const withComment = { ...task, comments: [repliedComment] }
        await run(Effect.flatMap(TaskRepository, (r) => r.update(withComment)))
        await run(updateTask(task.id, to, null, task.assignee!.id))
      } else {
        await run(updateTask(task.id, to, comment, task.assignee!.id))
      }
      const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
      expect(updated.status).toBe(to)
      expect(spy.calls.length).toBe(1)
      expect(spy.calls[0]?.new_status).toBe(to)
    })
  }
})

// ──────────────────────────────────────────
// Invalid transitions
// ──────────────────────────────────────────
describe("updateTask / invalid transitions", () => {
  const invalid: Array<[Status, Status]> = [
    ["backlog", "pending_review"],
    ["backlog", "done"],
    ["backlog", "in_progress"],
    ["todo", "done"],
    ["need_info", "done"],
    ["done", "in_progress"],
  ]

  for (const [from, to] of invalid) {
    test(`${from} → ${to}: transition_not_allowed, task unchanged, no hook`, async () => {
      const task = await seedTask({ status: from })
      const err = await runFail(updateTask(task.id, to, null, task.assignee!.id))
      expect(err._tag).toBe("transition_not_allowed")
      const unchanged = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
      expect(unchanged.status).toBe(from)
      expect(spy.calls.length).toBe(0)
    })
  }
})

// ──────────────────────────────────────────
// No-op
// ──────────────────────────────────────────
describe("updateTask / no-op", () => {
  test("blocked → blocked: succeeds, no hook", async () => {
    const task = await seedTask({ status: "blocked" })
    await run(updateTask(task.id, "blocked", null, task.assignee!.id))
    expect(spy.calls.length).toBe(0)
  })
})

// ──────────────────────────────────────────
// Not found
// ──────────────────────────────────────────
describe("updateTask / not_found", () => {
  test("nonexistent id → not_found", async () => {
    const err = await runFail(updateTask("ghost-id", "todo", null, "s1"))
    expect(err._tag).toBe("not_found")
  })
})

// ──────────────────────────────────────────
// Comment rules: need_info
// ──────────────────────────────────────────
describe("updateTask / need_info comment rules", () => {
  test("→ need_info without comment → missing_comment", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const err = await runFail(updateTask(task.id, "need_info", null, task.assignee!.id))
    expect(err._tag).toBe("missing_comment")
  })

  test("→ need_info with comment → fires hook with new_status: need_info", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const comment = makeComment({ kind: "need_info", content: "blocking question" })
    await run(updateTask(task.id, "need_info", comment, task.assignee!.id))
    expect(spy.calls.length).toBe(1)
    expect(spy.calls[0]?.new_status).toBe("need_info")
  })
})

// ──────────────────────────────────────────
// Comment rules: blocked
// ──────────────────────────────────────────
describe("updateTask / blocked comment rules", () => {
  test("→ blocked without comment → missing_comment", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const err = await runFail(updateTask(task.id, "blocked", null, task.assignee!.id))
    expect(err._tag).toBe("missing_comment")
  })

  test("→ blocked with empty content → validation_error", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const comment = makeComment({ content: "" })
    const err = await runFail(updateTask(task.id, "blocked", comment, task.assignee!.id))
    expect(err).toMatchObject({ _tag: "validation_error" })
  })

  test("→ blocked with non-empty content → succeeds", async () => {
    const task = await seedTask({ status: "in_progress", in_progress_since: new Date() })
    const comment = makeComment({ content: "Waiting on API key" })
    await run(updateTask(task.id, "blocked", comment, task.assignee!.id))
    const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
    expect(updated.status).toBe("blocked")
  })
})

// ──────────────────────────────────────────
// need_info reply cycle
// ──────────────────────────────────────────
describe("updateTask / need_info reply cycle", () => {
  test("update with matching comment id and non-empty reply → reply populated, task stays need_info", async () => {
    const blocking = makeComment({ id: "c-1", kind: "need_info", content: "what?", reply: "" })
    const task = await seedTask({ status: "need_info", comments: [blocking] })
    const replyComment = makeComment({
      id: "c-1",
      kind: "need_info",
      reply: "the answer",
      content: "what?",
    })
    await run(updateTask(task.id, "need_info", replyComment, task.assignee!.id))
    const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
    expect(updated.comments.find((c) => c.id === "c-1")?.reply).toBe("the answer")
    expect(updated.status).toBe("need_info")
  })

  test("need_info→in_progress when blocking comment has empty reply → validation_error", async () => {
    const blocking = makeComment({ id: "c-1", kind: "need_info", content: "what?", reply: "" })
    const task = await seedTask({ status: "need_info", comments: [blocking] })
    const err = await runFail(updateTask(task.id, "in_progress", null, task.assignee!.id))
    expect(err).toMatchObject({
      _tag: "validation_error",
      message: "blocking comment c-1 has no reply",
    })
  })

  test("need_info→in_progress after reply populated → succeeds", async () => {
    const blocking = makeComment({ id: "c-1", kind: "need_info", content: "what?", reply: "done" })
    const task = await seedTask({ status: "need_info", comments: [blocking] })
    await run(updateTask(task.id, "in_progress", null, task.assignee!.id))
    const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
    expect(updated.status).toBe("in_progress")
  })

  test("reply on kind: regular comment → validation_error", async () => {
    const regularComment = makeComment({ id: "c-2", kind: "regular", content: "note" })
    const task = await seedTask({
      status: "in_progress",
      in_progress_since: new Date(),
      comments: [regularComment],
    })
    const withReply = makeComment({ id: "c-2", kind: "regular", content: "note", reply: "oops" })
    const err = await runFail(updateTask(task.id, "in_progress", withReply, task.assignee!.id))
    expect(err).toMatchObject({
      _tag: "validation_error",
      message: "reply is only valid on need_info comments",
    })
  })
})

// ──────────────────────────────────────────
// Concurrent in_progress
// ──────────────────────────────────────────
describe("updateTask / concurrent in_progress", () => {
  test("second task with empty justification → error", async () => {
    const agent = makeAgent({ id: "session-x" })
    await seedTask({ status: "in_progress", assignee: agent, in_progress_since: new Date() })
    const task2 = await seedTask({ status: "todo", assignee: agent })
    const comment = makeComment({ content: "" })
    const err = await runFail(updateTask(task2.id, "in_progress", comment, "session-x"))
    expect(err._tag).toBeTruthy() // some error requiring justification
  })

  test("second task with non-empty justification → succeeds", async () => {
    const agent = makeAgent({ id: "session-y" })
    await seedTask({ status: "in_progress", assignee: agent, in_progress_since: new Date() })
    const task2 = await seedTask({ status: "todo", assignee: agent })
    const comment = makeComment({ content: "Urgent context switch needed" })
    await run(updateTask(task2.id, "in_progress", comment, "session-y"))
    const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task2.id)))
    expect(updated.status).toBe("in_progress")
  })

  test("first task (no existing in_progress) → succeeds with no extra constraint", async () => {
    const task = await seedTask({ status: "todo" })
    await run(updateTask(task.id, "in_progress", null, task.assignee!.id))
    const updated = await run(Effect.flatMap(TaskRepository, (r) => r.findById(task.id)))
    expect(updated.status).toBe("in_progress")
  })
})
