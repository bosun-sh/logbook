import type { Agent, Comment, CommentKind, Status, Task } from "@logbook/domain/types.js"

let agentCounter = 0
let commentCounter = 0
let taskCounter = 0

export const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: `agent-${++agentCounter}`,
  title: "Test Agent",
  description: "A test agent",
  ...overrides,
})

export const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: `c-${++commentCounter}`,
  timestamp: new Date("2026-01-01T00:00:00Z"),
  title: "Test comment",
  content: "Some content",
  reply: "",
  kind: "regular" as CommentKind,
  ...overrides,
})

export const makeTask = (overrides: Partial<Task> = {}): Task => ({
  project: "test-project",
  milestone: "m1",
  id: `task-${++taskCounter}`,
  title: "Test task",
  definition_of_done: ["It works"],
  test_cases: ["It passes the happy path"],
  description: "A task for testing",
  assigned_session: "session-test",
  assigned_model: "claude-haiku-4-5-20251001",
  estimation: 1,
  comments: [],
  assignee: makeAgent(),
  status: "backlog" as Status,
  priority: 0,
  ...overrides,
})
