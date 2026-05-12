import type { ContextEntry, ExternalLink } from "@logbook/context/schema.js"
import { ExternalLinkSchema } from "@logbook/context/schema.js"
import type { Epic } from "@logbook/epic/schema.js"
import { JsonlRepository } from "@logbook/shared/storage/jsonl-repository.js"
import type { Story } from "@logbook/story/schema.js"
import { readLinearApiToken, readLinearWorkspaceConfig } from "@logbook/sync/linear/config.js"
import { type LinearGraphQLClient, LinearTransport } from "@logbook/sync/linear/transport.js"
import type { SyncConflict, SyncEvent } from "@logbook/sync/schema.js"
import { SyncConflictSchema, SyncEventSchema } from "@logbook/sync/schema.js"
import { TaskRepository } from "@logbook/task/ports.js"
import { Context, Effect, Layer } from "effect"
import {
  ContextRepository,
  EpicRepository,
  StoryRepository,
  TaskRepository as WorkspaceTaskRepository,
} from "./repositories.js"
import { resolveWorkspacePaths } from "./storage-layout.js"

const StoryRepositoryTag = Context.GenericTag<JsonlRepository<Story>>("StoryRepository")
const EpicRepositoryTag = Context.GenericTag<JsonlRepository<Epic>>("EpicRepository")
const ContextRepositoryTag = Context.GenericTag<JsonlRepository<ContextEntry>>("ContextRepository")
const ExternalLinkRepositoryTag =
  Context.GenericTag<JsonlRepository<ExternalLink>>("ExternalLinkRepository")
const SyncEventRepositoryTag = Context.GenericTag<JsonlRepository<SyncEvent>>("SyncEventRepository")
const SyncConflictRepositoryTag =
  Context.GenericTag<JsonlRepository<SyncConflict>>("SyncConflictRepository")
const LinearGraphQLClientTag = Context.GenericTag<LinearGraphQLClient>("LinearGraphQLClient")

export const makeLogbookLayer = (workspaceRoot: string) => {
  const paths = resolveWorkspacePaths(workspaceRoot)
  const opts = { workspaceRoot, initialized: true }

  const externalLinkRepo = new JsonlRepository<ExternalLink>({
    entityName: "external link",
    filePath: paths.externalLinks,
    schema: ExternalLinkSchema,
    initialized: true,
  })

  const syncEventRepo = new JsonlRepository<SyncEvent>({
    entityName: "sync event",
    filePath: paths.syncEvents,
    schema: SyncEventSchema,
    initialized: true,
  })

  const syncConflictRepo = new JsonlRepository<SyncConflict>({
    entityName: "sync conflict",
    filePath: paths.syncConflicts,
    schema: SyncConflictSchema,
    initialized: true,
  })

  const taskRepo = new WorkspaceTaskRepository(opts)

  return Layer.mergeAll(
    Layer.succeed(TaskRepository, taskRepo.asPort()),
    Layer.succeed(StoryRepositoryTag, new StoryRepository(opts)),
    Layer.succeed(EpicRepositoryTag, new EpicRepository(opts)),
    Layer.succeed(ContextRepositoryTag, new ContextRepository(opts)),
    Layer.succeed(ExternalLinkRepositoryTag, externalLinkRepo),
    Layer.succeed(SyncEventRepositoryTag, syncEventRepo),
    Layer.succeed(SyncConflictRepositoryTag, syncConflictRepo),
    Layer.succeed(LinearGraphQLClientTag, makeWorkspaceLinearClient(workspaceRoot))
  )
}

export { makeLogbookLayer as LogbookLayer }
export type LogbookLayer = ReturnType<typeof makeLogbookLayer>

const makeWorkspaceLinearClient = (workspaceRoot: string): LinearGraphQLClient => ({
  request: <TData extends Record<string, unknown>>(
    request: Parameters<LinearGraphQLClient["request"]>[0]
  ) =>
    Effect.gen(function* () {
      const configResult = yield* Effect.promise(() => readLinearWorkspaceConfig(workspaceRoot))
      const config = configResult.ok ? configResult.data : undefined
      const apiToken = readLinearApiToken(config, workspaceRoot) ?? ""
      return yield* LinearTransport.make({ apiToken }).request<TData>(request)
    }),
})
