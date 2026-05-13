import { Effect, Layer } from "effect"
import { makeLogbookLayer } from "./layers.js"

export const LogbookRuntime = (workspaceRoot: string) =>
  Effect.scoped(Layer.toRuntime(makeLogbookLayer(workspaceRoot)))

export type LogbookRuntime = ReturnType<typeof LogbookRuntime>
