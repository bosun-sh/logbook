import { describe, expect, test } from "bun:test"
import type { Comment, CommentReply } from "@logbook/shared/schema/value-objects.js"
import { appendTaskComment } from "@logbook/task/comments.js"
import { transitionTaskStatus } from "@logbook/task/lifecycle.js"
import { appendTaskReply, compareTasksForList } from "@logbook/task/ordering.js"
import type { Task } from "@logbook/task/schema.js"

const NOW = "2026-01-02T00:00:00.000Z"

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  project: "migration",
  milestone: "task-06",
  title: "Lifecycle domain",
  description: "Pure lifecycle behavior",
  definitionOfDone: "Transitions pass",
  status: "todo",
  priority: 0,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 2,
    complexity: "small",
    fibonacci: 2,
    confidence: "high",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
  ...overrides,
})

const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: "comment-1",
  title: "Status update",
  content: "Ready for review",
  kind: "regular",
  createdAt: NOW,
  replies: [],
  ...overrides,
})

const makeCommentWithoutKind = (overrides: Omit<Partial<Comment>, "kind"> = {}) => {
  const { kind: _kind, ...comment } = makeComment(overrides)
  return comment as Omit<Comment, "kind"> & { readonly kind?: Comment["kind"] }
}

describe("transitionTaskStatus", () => {
  test("applies allowed transitions and manages inProgressSince", () => {
    const entered = transitionTaskStatus(makeTask({ status: "backlog" }), "todo", { now: NOW })
    const started = transitionTaskStatus(makeTask({ status: "todo" }), "in_progress", {
      now: NOW,
      comment: makeCommentWithoutKind(),
    })
    const sideExit = transitionTaskStatus(
      makeTask({ status: "in_progress", inProgressSince: "2026-01-01T12:00:00.000Z" }),
      "blocked",
      { now: "2026-01-03T00:00:00.000Z", comment: makeComment({ kind: "regular" }) }
    )
    const returnToProgress = transitionTaskStatus(makeTask({ status: "blocked" }), "in_progress", {
      now: "2026-01-04T00:00:00.000Z",
    })
    const review = transitionTaskStatus(makeTask({ status: "pending_review" }), "done", {
      now: "2026-01-05T00:00:00.000Z",
      comment: makeCommentWithoutKind(),
    })

    expect(entered.ok).toBe(true)
    expect(started.ok).toBe(true)
    expect(sideExit.ok).toBe(true)
    expect(returnToProgress.ok).toBe(true)
    expect(review.ok).toBe(true)

    if (entered.ok) {
      expect(entered.data.status).toBe("todo")
      expect(entered.data.updatedAt).toBe(NOW)
      expect(entered.data.inProgressSince).toBeUndefined()
    }

    if (started.ok) {
      expect(started.data.status).toBe("in_progress")
      expect(started.data.updatedAt).toBe(NOW)
      expect(started.data.inProgressSince).toBe(NOW)
      expect(started.data.comments[0]?.kind).toBe("regular")
    }

    if (sideExit.ok) {
      expect(sideExit.data.status).toBe("blocked")
      expect(sideExit.data.inProgressSince).toBeUndefined()
      expect(sideExit.data.comments[0]?.kind).toBe("regular")
    }

    if (returnToProgress.ok) {
      expect(returnToProgress.data.status).toBe("in_progress")
      expect(returnToProgress.data.inProgressSince).toBe("2026-01-04T00:00:00.000Z")
    }

    if (review.ok) {
      expect(review.data.status).toBe("done")
      expect(review.data.inProgressSince).toBeUndefined()
      expect(review.data.comments[0]?.kind).toBe("review")
    }
  })

  test("returns the existing task for no-op transitions without appending comments", () => {
    const task = makeTask({ status: "in_progress", inProgressSince: NOW })
    const result = transitionTaskStatus(task, "in_progress", {
      now: "2026-01-03T00:00:00.000Z",
      comment: makeComment(),
    })

    expect(result).toEqual({ ok: true, data: task })
  })

  test("rejects forbidden transitions with invalid_transition", () => {
    const result = transitionTaskStatus(makeTask({ status: "done" }), "todo", { now: NOW })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_transition")
    }
  })

  test("requires correct local comments for need_info and blocked side exits", () => {
    const needInfo = transitionTaskStatus(makeTask({ status: "in_progress" }), "need_info", {
      now: NOW,
      comment: makeComment({ kind: "regular" }),
    })
    const needInfoSync = transitionTaskStatus(makeTask({ status: "in_progress" }), "need_info", {
      now: NOW,
      comment: makeComment({ kind: "sync" }),
    })
    const blocked = transitionTaskStatus(makeTask({ status: "in_progress" }), "blocked", {
      now: NOW,
      comment: makeComment({ kind: "sync" }),
    })
    const accepted = transitionTaskStatus(makeTask({ status: "in_progress" }), "blocked", {
      now: NOW,
      comment: makeComment({ kind: "need_info" }),
    })

    expect(needInfo.ok).toBe(false)
    expect(needInfoSync.ok).toBe(false)
    expect(blocked.ok).toBe(false)
    expect(accepted.ok).toBe(true)
  })

  test("defaults review comments for pending_review and done transitions", () => {
    const pendingReview = transitionTaskStatus(
      makeTask({ status: "in_progress", inProgressSince: NOW }),
      "pending_review",
      { now: "2026-01-03T00:00:00.000Z", comment: makeCommentWithoutKind() }
    )

    expect(pendingReview.ok).toBe(true)
    if (pendingReview.ok) {
      expect(pendingReview.data.comments[0]?.kind).toBe("review")
    }
  })

  test("ignores comments on no-op transitions", () => {
    const task = makeTask({ status: "in_progress", inProgressSince: NOW })
    const result = transitionTaskStatus(task, "in_progress", {
      now: "2026-01-03T00:00:00.000Z",
      comment: makeCommentWithoutKind(),
    })

    expect(result).toEqual({ ok: true, data: task })
  })
})

describe("task comments and ordering", () => {
  test("appendTaskComment validates priority and comment byte bounds", () => {
    const exactBoundary = appendTaskComment(
      makeTask(),
      makeComment({ content: "x".repeat(65_536) })
    )
    const invalidPriority = appendTaskComment(makeTask({ priority: -1 }), makeComment())
    const oversizedComment = appendTaskComment(
      makeTask(),
      makeComment({ content: "x".repeat(65_537) })
    )

    expect(exactBoundary.ok).toBe(true)
    expect(invalidPriority.ok).toBe(false)
    expect(oversizedComment.ok).toBe(false)
    if (!invalidPriority.ok && !oversizedComment.ok) {
      expect(invalidPriority.error.code).toBe("validation_error")
      expect(oversizedComment.error.code).toBe("validation_error")
    }
  })

  test("appendTaskReply targets an existing comment without changing status", () => {
    const task = makeTask({ comments: [makeComment()] })
    const reply: CommentReply = {
      id: "reply-1",
      content: "Acknowledged",
      createdAt: "2026-01-04T00:00:00.000Z",
    }

    const result = appendTaskReply(task, "comment-1", reply)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.status).toBe(task.status)
      expect(result.data.updatedAt).toBe(reply.createdAt)
      expect(result.data.comments[0]?.replies).toEqual([reply])
    }
  })

  test("appendTaskReply rejects invalid priority and unknown comments", () => {
    const invalidPriority = appendTaskReply(
      makeTask({ priority: -1, comments: [makeComment()] }),
      "comment-1",
      {
        id: "reply-2",
        content: "Ack",
        createdAt: "2026-01-04T00:00:00.000Z",
      }
    )
    const missingComment = appendTaskReply(makeTask({ comments: [makeComment()] }), "missing", {
      id: "reply-3",
      content: "Ack",
      createdAt: "2026-01-04T00:00:00.000Z",
    })

    expect(invalidPriority.ok).toBe(false)
    expect(missingComment.ok).toBe(false)
    if (!invalidPriority.ok && !missingComment.ok) {
      expect(invalidPriority.error.code).toBe("validation_error")
      expect(missingComment.error.code).toBe("not_found")
    }
  })

  test("appendTaskReply validates reply content bytes", () => {
    const result = appendTaskReply(makeTask({ comments: [makeComment()] }), "comment-1", {
      id: "reply-4",
      content: "x".repeat(65_537),
      createdAt: "2026-01-04T00:00:00.000Z",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error")
    }
  })

  test("compareTasksForList sorts by priority descending, updatedAt descending, then id", () => {
    const tasks = [
      makeTask({ id: "task-b", priority: 1, updatedAt: "2026-01-01T00:00:00.000Z" }),
      makeTask({ id: "task-c", priority: 2, updatedAt: "2026-01-01T00:00:00.000Z" }),
      makeTask({ id: "task-a", priority: 1, updatedAt: "2026-01-03T00:00:00.000Z" }),
      makeTask({ id: "task-d", priority: 1, updatedAt: "2026-01-03T00:00:00.000Z" }),
    ].sort(compareTasksForList)

    expect(tasks.map((task) => task.id)).toEqual(["task-c", "task-a", "task-d", "task-b"])
  })
})
