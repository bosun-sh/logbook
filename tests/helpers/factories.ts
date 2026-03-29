import type { Agent, Comment, Task, CommentKind, Status } from "@logbook/domain/types.js"

let agentCounter = 0
let commentCounter = 0
let taskCounter = 0

export const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id:          `agent-${++agentCounter}`,
  title:       "Test Agent",
  description: "A test agent",
  ...overrides,
})

export const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id:        `c-${++commentCounter}`,
  timestamp: new Date("2026-01-01T00:00:00Z"),
  title:     "Test comment",
  content:   "Some content",
  reply:     "",
  kind:      "regular" as CommentKind,
  ...overrides,
})

export const makeTask = (overrides: Partial<Task> = {}): Task => ({
  project:            "test-project",
  milestone:          "m1",
  id:                 `task-${++taskCounter}`,
  title:              "Test task",
  definition_of_done: "It works",
  description:        "A task for testing",
  estimation:         1,
  comments:           [],
  assignee:           makeAgent(),
  status:             "backlog" as Status,
  ...overrides,
})
