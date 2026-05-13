# App And Scaffold Workflow

Use this for new apps, starter templates, `ohtools create`, `ohtools init`, or
scaffold review.

## Commands

```sh
npx @bosun-sh/ohtools create my-tools
npx @bosun-sh/ohtools init
bunx ohtools create my-tools
bunx ohtools init
```

`create` makes a new project directory and must fail if the directory already
exists. `init` runs in an existing Bun TypeScript project and must be
non-destructive: create missing files, update missing scripts/dependencies, and
report skipped conflicts instead of overwriting user files.

## Starter Expectations

- `src/ohtools.ts` exports a default `Ohtools` app.
- The starter includes at least one typed runnable tool with a JSON Schema
  object input.
- Scripts use the app entry path and can list, document, graph, and run a tool.
- `tsconfig.json` supports Bun TypeScript with Node-style module resolution.
- Dependencies include `@bosun-sh/ohtools`, `@modelcontextprotocol/sdk`, and
  `effect`; dev dependencies include TypeScript and Bun types.
- README commands must run from a fresh scaffold.
- The local skill is copied to `.agents/skills/ohtools/`.

Useful scripts:

```json
{
  "typecheck": "tsc --noEmit",
  "ohtools:list": "bunx ohtools --app ./src/ohtools.ts list",
  "ohtools:docs": "bunx ohtools --app ./src/ohtools.ts docs",
  "ohtools:graph": "bunx ohtools --app ./src/ohtools.ts graph",
  "ohtools:hello": "bunx ohtools --app ./src/ohtools.ts run hello --input '{\"name\":\"Ada\"}'"
}
```

## Conflict Handling

- Never force scaffold overwrites unless the command has an explicit force
  option and the user asked for it.
- If `src/ohtools.ts` exists, skip it. If `src/app.ts` already contains an
  Ohtools app, report that app instead of creating a conflicting entry.
- Preserve existing scripts and dependency ranges. Add only missing entries.
- When scaffold behavior changes, update templates, README/docs, examples, and
  packed smoke coverage together.
