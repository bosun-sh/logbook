import { Layer } from "effect"
import { executeHooks } from "../hook/hook-executor.js"
import type { HookEvent } from "../hook/ports.js"
import { HookRunner } from "../hook/ports.js"
import { loadHookConfigs } from "../infra/hook-config-loader.js"
import { JsonlTaskRepository } from "../infra/jsonl-task-repository.js"
import { PidSessionRegistry } from "../infra/pid-session-registry.js"
import { TaskRepository } from "../task/ports.js"
import { SessionRegistry } from "../task/session-registry.js"

export interface LayerConfig {
  tasksFile: string
  hooksDir: string
}

export const createLayer = async (
  config: LayerConfig
): Promise<Layer.Layer<TaskRepository | HookRunner | SessionRegistry>> => {
  const configs = await loadHookConfigs(config.hooksDir)
  const repo = new JsonlTaskRepository(config.tasksFile)
  const registry = new PidSessionRegistry(config.tasksFile)

  const hookRunnerImpl: HookRunner = {
    run: (event: HookEvent) => executeHooks(event, configs),
  }

  const repoLayer: Layer.Layer<TaskRepository> = Layer.succeed(TaskRepository, repo)
  const fullLayer: Layer.Layer<TaskRepository | HookRunner | SessionRegistry> = Layer.merge(
    Layer.merge(repoLayer, Layer.succeed(HookRunner, hookRunnerImpl)),
    Layer.succeed(SessionRegistry, registry)
  )

  return fullLayer
}
