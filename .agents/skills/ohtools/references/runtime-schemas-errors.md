# Runtime, Schemas, And Errors

Use this for JSON Schema boundaries, output design, Effect handlers, runtime
layers, cancellation, timeouts, and error behavior.

## Schemas

Use `jsonSchema<T>()` for values that cross process, CLI, MCP, or agent
boundaries. MCP executable tools require object-rooted input schemas; avoid
circular object refs and circular local `$ref`s.

```ts
input: jsonSchema<{ name: string }>({
  type: "object",
  properties: { name: { type: "string", minLength: 1 } },
  required: ["name"],
  additionalProperties: false,
})
```

Schema rules:

- Put required fields in `required`.
- Use `additionalProperties: false` when extra input is ambiguous.
- Prefer shallow local `$defs` over deeply recursive schemas.
- Add output schemas when the result is public, consumed by another tool, or
  used in examples and docs.
- Return structured objects instead of display strings when another tool or
  agent may use the result.

## Runtime And Effect

Tool handlers may return a plain value, a Promise, or an `Effect`. The runtime
wraps `explore`, `run`, and `runTool` in Effect values.

- Keep external I/O in handlers or injected services, not in registry build or
  exploration.
- Pass services through runtime options/layers or factories rather than hidden
  globals.
- Respect `context.signal` or runtime `signal` for cancellation before and
  during slow work.
- For timeouts, prefer explicit Effect timeout behavior or caller-controlled
  AbortSignals so cancellation is observable and testable.
- Keep handlers idempotent when agents may retry after transport failures.

## Errors

Use Ohtools structured errors for expected failures. Preserve normalized error
codes across adapters:

- validation failures should surface as `OHTOOLS_VALIDATION_ERROR`
- missing tools or unrunnable groups should stay distinguishable
- handler failures should become `OHTOOLS_HANDLER_ERROR`
- adapter translation failures should become `OHTOOLS_ADAPTER_ERROR`

CLI output is JSON envelopes by default and human-readable only with `--human`.
MCP errors should return structured error content rather than throwing raw
implementation errors through the transport.
