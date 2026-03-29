# logbook: kanban for ai agents

logbook is a kanban board implementation for autonomous agentic development, focusing on autonomous development and context window management.

## problem

ai agents changed the way software teams worked, and with specification-driven development we encounter a rift: **agents don't manage their tasks as we do**.

### what's the issue with this?

- hard for humans to track autonomous work properly: **"do you know what specific tasks your agent did?"**
- hard for agents to track tasks in-progress and done: **not a centralized way to track tasks so each instance haves to figure this out**
- existing tools add too much overload and are human-centered: **if an agent is going to use it, then it should be tailored for agents**

## solution

logbook is a file-system based kanban board that uses jsonl files to enter one task per line in a structured and clean approach and gives the agent the right tools to use it:

### tools

- the agent can call `list_tasks(status)` and  receive a list of the tasks in that status _(in_progress by default)_
- the agent can call `current_task()` and receive the current task _(only task in_progress)_
- the agent can call `update_task(id, new_status, new_comment)` and update the tasks to the new status adding a comment to justify it

each one of this tools-and more to add-have the sole purpose of removing overload from the agent context, handling the _"heavy load"_ programatically on the mcp server.

## architecture

- **runtime**: Bun / TypeScript
- **effect system**: Effect.ts — all async operations and errors are modeled as `Effect<A, E, R>`
- **architecture**: hexagonal (ports & adapters), organized by vertical slices per domain concept (task, hook)
- **validation**: Zod at every system boundary (MCP input, filesystem reads)
- **persistence**: JSONL — one task per line, append-only writes, full file scan for reads

JSONL was chosen for simplicity and agent-friendliness: a single line = a single task makes partial reads and diffs readable without tooling.

### hooks

besides the tools that the agent call manually, each action performed in the kanban can have automatic _hooks_ executed right before or after.
the default hooks include:

- after moving a task to `need_info`, the user receives a notification with the comment left to be able to answer the question.
- after moving a task to `pending_review`, a reviewer sub-agent spawns and a review task is automatically generated for it.
- when a second task is moved to `in_progress`, a built-in hook fires and requires a comment justifying the overlap before proceeding.

but hooks can also be defined by the user as scripts in any language as long as it's installed in the system, under the "hooks/" directory, following this structure:

```
hooks/
└── example_hook/
    ├── config.yml
    └── script.ts
```

a minimal `config.yml` looks like:

```yaml
# config.yml
event: task.status_changed   # lifecycle event that triggers the hook
condition: "new_status == 'need_info'"  # optional; JS-like expression
timeout_ms: 5000             # optional; default 5000
```

you can base your config.yml in the default hooks-which have complete configuration files.

> note: as mentioned, you can change .ts for any language, but the .yml / .yaml is required for configuration.

#### why hooks?

hooks don't need to store information from one execution to the other, so the main principle here is: **"execute and forget"**, this way we can focus on the kanban and actual tasks.

## contracts

the core types the server operates on:

```ts
type Agent = {
  id: string,       // session_id assigned by the server on connection
  title: string,
  description: string
}

type Status = 'backlog' | 'todo' | 'need_info' | 'blocked' | 'in_progress' | 'pending_review' | 'done'

type Comment = {
  id: string,
  timestamp: Date,
  title: string,
  content: string,
  reply: string   // user's reply, populated when responding to a need_info comment
}

type Task = {
  project: string,
  milestone: string,
  id: string,
  title: string,
  definition_of_done: string,
  description: string,
  estimation: number, // fibonacci scale
  comments: Comment[],
  assignee: Agent
}

// status defaults to 'in_progress'
type ListTasks = (status: Status | '*') => Task[]

// returns the highest-priority in_progress task for the current session.
// if a second task is moved to in_progress, a built-in hook fires and
// requires a comment justifying the overlap.
type GetCurrentTask = () => Task

// returns nothing, updates the task
type UpdateTask = (id: string, new_status: Status, new_comment: Comment) => void
```

each MCP session is treated as a distinct agent instance. the server assigns a `session_id` on connection and uses it to scope `GetCurrentTask` — no explicit agent ID needs to be passed by the caller.
