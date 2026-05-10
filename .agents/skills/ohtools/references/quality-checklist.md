# Quality Checklist

Use this for reviews, compatibility audits, release readiness, and final passes.

## Agent Usability

- Can an agent discover the right tool from `list`, `explore`, docs, and graph
  output without reading source?
- Are tool descriptions action-oriented and specific about side effects?
- Are inputs object-rooted, bounded, and named with domain terms?
- Are outputs structured enough for follow-up tools and summaries?
- Do `next` hints lead to registered tools or groups and explain why?
- Are dangerous operations explicit in names, descriptions, inputs, and docs?

## Compatibility

- Public exports still match current usage: `Ohtools`, `defineTool`,
  `defineGroup`, `plugin`, `jsonSchema`, `cliAdapter`, and `mcpAdapter`.
- CLI commands remain compatible: `create`, `init`, `list`, `explore`, `run`,
  `graph`, `docs`, `--app`, `--input`, `--format json`, and `--human`.
- MCP runnable tool schemas are object-rooted and non-circular.
- Public tool IDs, group IDs, plugin names, schema fields, metadata keys, and
  docs links are stable unless the task intentionally breaks them.
- Existing examples, scaffold templates, and generated docs still reflect real
  commands and imports.

## Validation Coverage

- Narrow code changes have focused tests or a deliberate reason no test is
  useful.
- Shared runtime, schema, adapter, scaffold, or package changes have coverage
  across tests, examples, docs snippets, and stage gates.
- Release or package changes run `pack:check` and `smoke:packed`.
- Docs-only changes run link/snippet checks when commands or snippets changed.

## Do Not Do

- Do not add hidden dynamic tool discovery by default.
- Do not return display-only strings when structured output is useful.
- Do not force scaffold overwrites or silently replace user files.
- Do not publish, tag, or change package release state without maintainer
  direction.
- Do not document unsupported runtimes, unpublished package names, or commands
  that do not exist.
