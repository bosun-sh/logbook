# Tool, Plugin, And Hierarchy Authoring

Use this for tool APIs, plugin composition, hierarchy design, metadata, or
`next` planning.

## Tool Definitions

Use fluent `.tool("id", definition)` for small app-local tools. Use
`defineTool` when the definition is reused by tests, groups, plugins, runtime
callers, or examples.

```ts
import { defineTool, jsonSchema } from "@bosun-sh/ohtools";

export const hello = defineTool({
  id: "hello",
  description: "Return a greeting.",
  input: jsonSchema<{ name: string }>({
    type: "object",
    properties: { name: { type: "string", minLength: 1 } },
    required: ["name"],
    additionalProperties: false,
  }),
  run: ({ name }) => ({ message: `Hello, ${name}` }),
});
```

Tool descriptions are required. IDs must match the Ohtools ID pattern, avoid
`..`, stay stable after release, and use lowercase dotted hierarchy when the
domain has natural ownership boundaries.

## Groups And Plugins

Use groups to make large registries explorable. Inside a group builder,
`.tool("list", ...)` becomes `group-id.list`, and nested groups receive the
same prefix behavior.

```ts
import { defineGroup, plugin } from "@bosun-sh/ohtools";

export const support = defineGroup(
  { id: "support", description: "Support workflows." },
  (group) => group.tool(hello),
);

export const supportPlugin = plugin("support").group(support);
```

Use plugins when a coherent capability should move as a unit across apps.
Plugins may contribute tools, groups, adapters, and metadata. Compose plugins at
the app boundary with `.use(plugin)`.

## Planning Metadata

- Use `title` for display labels, not as the machine contract.
- Use `metadata` for stable structured hints that docs, adapters, or agents can
  inspect.
- Use `mode: "explore"` for non-runnable exploration nodes and `mode: "both"`
  or omitted mode for normal executable tools.
- Use `hierarchy.visible: false` only when a tool should be runnable but hidden
  from default exploration.

## Next Steps

`next` can point to registered tool or group IDs and may include a reason,
`exploreFirst`, `optional`, and a `when` condition. Keep `next` deterministic
and cheap; failed or async-only next resolvers become warnings in exploration.

Do not invent display-only strings where structured `next`, metadata, or output
objects would let agents plan reliably.
