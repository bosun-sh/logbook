import { describe, expect, test } from "bun:test"
import {
  type LinearIssueRecord,
  mapLinearComment,
  mapLinearIssueToTask,
  mapTaskToLinearIssueInput,
} from "@logbook/sync/linear/mapping.js"
import type { Task } from "@logbook/task/schema.js"

const issue: LinearIssueRecord = {
  id: "issue_1",
  identifier: "LOG-123",
  url: "https://linear.app/acme/issue/LOG-123/example",
  title: "Ship sync",
  description: "Implement provider sync.",
  priority: 2,
  updatedAt: "2026-01-03T00:00:00.000Z",
  archivedAt: null,
  team: { id: "team_1", key: "LOG", name: "Logbook" },
  project: { id: "project_1", name: "Migration" },
  state: { id: "state_started", name: "In Progress", type: "started" },
  assignee: { id: "user_1", name: "Ada" },
  labels: {
    nodes: [
      { id: "label_1", name: "backend" },
      { id: "label_2", name: "sync" },
    ],
  },
}

const task: Task = {
  id: "task_1",
  schemaVersion: "2",
  kind: "task",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  project: "Migration",
  milestone: "LOG",
  title: "Ship sync",
  description: "Implement provider sync.",
  definitionOfDone: "Linear issue updated.",
  status: "in_progress",
  priority: 2,
  phaseModelOverrides: {},
  estimate: {
    predictedKTokens: 1,
    complexity: "small",
    fibonacci: 1,
    confidence: "low",
  },
  contextEntryIds: [],
  comments: [],
  externalLinks: [],
}

describe("Linear provider mapping", () => {
  test("maps Linear issues to task fields, provider metadata, topics, and external link snapshots", () => {
    const result = mapLinearIssueToTask(issue)

    expect(result).toEqual({
      ok: true,
      data: {
        taskFields: {
          title: "Ship sync",
          description: "Implement provider sync.",
          definitionOfDone: "Synced Linear issue LOG-123 is complete.",
          project: "Migration",
          milestone: "LOG",
          status: "in_progress",
          priority: 2,
          assignee: {
            id: "linear:user_1",
            title: "Ada",
          },
        },
        contextTopics: ["backend", "sync"],
        providerMetadata: {
          provider: "linear",
          issueId: "issue_1",
          identifier: "LOG-123",
          url: "https://linear.app/acme/issue/LOG-123/example",
          teamId: "team_1",
          teamKey: "LOG",
          projectId: "project_1",
          stateId: "state_started",
          labelIds: ["label_1", "label_2"],
        },
        remoteRecord: {
          id: "issue_1",
          url: "https://linear.app/acme/issue/LOG-123/example",
          type: "issue",
        },
        lastSeenRemoteVersion: "2026-01-03T00:00:00.000Z",
        tombstone: {
          archived: false,
        },
      },
    })
  })

  test("applies configured status and label overrides and preserves archive identity", () => {
    const result = mapLinearIssueToTask(
      {
        ...issue,
        archivedAt: "2026-01-04T00:00:00.000Z",
        state: { id: "state_review", name: "Review", type: "started" },
      },
      {
        statusMapping: {
          linearStateIdToTaskStatus: {
            state_review: "pending_review",
          },
        },
        labelMapping: {
          labelNameToTopic: {
            backend: "server",
          },
        },
      }
    )

    expect(result).toMatchObject({
      ok: true,
      data: {
        taskFields: {
          status: "pending_review",
        },
        contextTopics: ["server", "sync"],
        tombstone: {
          archived: true,
          archivedAt: "2026-01-04T00:00:00.000Z",
          decision: "preserve_local_identity",
        },
      },
    })
  })

  test("maps local task fields to Linear issue input with status and project configuration", () => {
    const result = mapTaskToLinearIssueInput(task, {
      defaultTeamId: "team_1",
      defaultProjectId: "project_1",
      statusMapping: {
        taskStatusToLinearStateId: {
          in_progress: "state_started",
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      data: {
        input: {
          title: "Ship sync",
          description: "Implement provider sync.",
          teamId: "team_1",
          projectId: "project_1",
          stateId: "state_started",
          priority: 2,
        },
      },
    })
  })

  test("requires a default team before creating a Linear issue", () => {
    const result = mapTaskToLinearIssueInput(task, {})

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
  })

  test("maps Linear comments to sync task comments", () => {
    const result = mapLinearComment({
      id: "comment_1",
      body: "Remote update",
      createdAt: "2026-01-03T12:00:00.000Z",
      user: { id: "user_1", name: "Ada" },
    })

    expect(result).toEqual({
      ok: true,
      data: {
        comment: {
          id: "linear_comment_1",
          title: "Linear comment",
          content: "Remote update",
          kind: "sync",
          createdAt: "2026-01-03T12:00:00.000Z",
          author: {
            id: "linear:user_1",
            title: "Ada",
          },
          replies: [],
        },
      },
    })
  })

  test("bounds provider configuration JSON", () => {
    const result = mapLinearIssueToTask(issue, {
      labelMapping: {
        labelNameToTopic: {
          backend: "x".repeat(65_536),
        },
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation_error",
      },
    })
  })
})
