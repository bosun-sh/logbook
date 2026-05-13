# CLI, MCP, Docs, Examples, And Release

Use this for CLI behavior, MCP adapters, generated docs, examples, stage
validation, pack checks, and release readiness.

## CLI

The package binary is `ohtools`. App commands require an app entry:

```sh
bunx ohtools --app ./src/ohtools.ts list
bunx ohtools --app ./src/ohtools.ts explore hello
bunx ohtools --app ./src/ohtools.ts run hello --input '{"name":"Ada"}'
bunx ohtools --app ./src/ohtools.ts graph
bunx ohtools --app ./src/ohtools.ts docs
bunx ohtools --app ./src/ohtools.ts docs --format json
```

Default CLI output is a JSON envelope. Use `--human` only for display-oriented
local use. Keep command names and envelopes compatible unless the user requests
a breaking CLI change.

## MCP

Attach MCP with:

```ts
import { mcpAdapter } from "@bosun-sh/ohtools/adapters/mcp";

export default new Ohtools().adapter(mcpAdapter());
```

Use stdio only in an app process intended to serve MCP:

```ts
mcpAdapter({ stdio: true })
```

MCP exposes runnable tools, `ohtools.explore`, `ohtools.graph`, and JSON
resources for graph, tools, and groups. Before adding MCP, verify all runnable
tool input schemas are object-rooted and non-circular.

## Docs And Examples

Generated docs should come from the registry whenever possible:

```sh
bunx ohtools --app ./src/ohtools.ts docs
```

When behavior changes, update the relevant README/docs pages and at least one
runnable example if the public usage changes. Examples should use public
imports only:

```ts
import { Ohtools, defineTool, defineGroup, plugin, jsonSchema } from "@bosun-sh/ohtools";
import { cliAdapter } from "@bosun-sh/ohtools/adapters/cli";
import { mcpAdapter } from "@bosun-sh/ohtools/adapters/mcp";
```

## Validation And Release

Use focused checks while developing, then stage gates based on risk:

```sh
bun test packages/ohtools/test/core.test.ts
bun test packages/ohtools/test/adapters.test.ts
bun run typecheck
bun run examples:check
bun run docs:snippets
bun run validate:stage0
bun run validate:stage5
bun run release:check
```

Stage expectations in the Ohtools workspace:

- `validate:stage0`: specs, typecheck, lint, docs build.
- `validate:stage1`: Stage 0 plus core tests.
- `validate:stage2`: Stage 1 plus public API/example checks.
- `validate:stage3`: Stage 2 plus runtime/adapter checks.
- `validate:stage4`: Stage 3 plus docs links and snippets.
- `validate:stage5`: Stage 4 plus `pack:check` and `smoke:packed`.
- `release:check`: release-blocking local validation, currently Stage 5.

`pack:check` must verify built JS, declarations, binary, skills, templates, and
package file inclusion. `smoke:packed` must verify the packed tarball can
create/init an app, import APIs, explore, run, and exercise MCP behavior. Do not
publish or tag unless a maintainer explicitly asks.
