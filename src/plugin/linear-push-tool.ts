import { defineTool } from "@bosun-sh/ohtools"
import { type PushLinearSyncInput, pushLinearSync } from "@logbook/sync/linear/push.js"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toStringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as readonly string[])
    : undefined

const asLinearPushInput = (input: unknown): PushLinearSyncInput =>
  isRecord(input)
    ? (() => {
        const taskIds = toStringArray(input.taskIds)
        const epicIds = toStringArray(input.epicIds)
        const storyIds = toStringArray(input.storyIds)
        return {
          ...(taskIds === undefined ? {} : { taskIds }),
          ...(epicIds === undefined ? {} : { epicIds }),
          ...(storyIds === undefined ? {} : { storyIds }),
          ...(typeof input.teamId === "string" ? { teamId: input.teamId } : {}),
          ...(typeof input.projectId === "string" ? { projectId: input.projectId } : {}),
          dryRun: input.dryRun === true,
        } satisfies PushLinearSyncInput
      })()
    : ({ dryRun: false } satisfies PushLinearSyncInput)

export const linearPushTool = defineTool({
  id: "sync.linear.push",
  description: "Push Logbook tasks to Linear.",
  run: (input: unknown) => pushLinearSync(asLinearPushInput(input)),
})
