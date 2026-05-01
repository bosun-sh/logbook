package logbook

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

type MCP struct {
	TasksFile string
	HooksDir  string
	SessionID string
	Layer     Layer
}

func RunMCP(args []string, env map[string]string) int {
	if len(args) > 0 {
		switch args[0] {
		case "init":
			if err := RunInit(".", false); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 1
			}
			return 0
		case "--version", "-v":
			fmt.Println(Version)
			return 0
		case "--help", "-h":
			fmt.Println("logbook-mcp [command]")
			fmt.Println()
			fmt.Println("Commands:")
			fmt.Println("  init        Scaffold tasks.jsonl, hooks/, and emit client config snippets")
			fmt.Println("  (default)   Start the MCP server (stdio transport)")
			return 0
		}
	}
	tasksFile := getenv(env, "LOGBOOK_TASKS_FILE", "./tasks.jsonl")
	hooksDir := getenv(env, "LOGBOOK_HOOKS_DIR", "./hooks")
	layer, err := NewLayer(tasksFile, hooksDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	sessionID := newUUID()
	_ = layer.Registry.Register(sessionID, os.Getpid())
	defer func() { _ = layer.Registry.Deregister(sessionID) }()
	m := MCP{TasksFile: tasksFile, HooksDir: hooksDir, SessionID: sessionID, Layer: layer}
	return m.serve()
}

func (m MCP) serve() int {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if stringsTrimSpace(line) == "" {
			continue
		}
		var req map[string]any
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			_ = writeJSON(os.Stdout, rpcError(nil, -32700, "Parse error", nil))
			continue
		}
		id, hasID := req["id"]
		method, _ := req["method"].(string)
		params := req["params"]
		if !hasID {
			_, _ = m.dispatch(method, params)
			continue
		}
		result, err := m.dispatch(method, params)
		if err != nil {
			if errors.Is(err, errMethodNotFound) {
				_ = writeJSON(os.Stdout, rpcError(id, -32601, "Method not found: "+method, nil))
				continue
			}
			if te, ok := IsTaskError(err); ok {
				mcp := taskErrorToMcpError(te)
				_ = writeJSON(os.Stdout, rpcError(id, mcp.Code, mcp.Message, mcp.Data))
				continue
			}
			if errors.Is(err, errInvalidParams) {
				_ = writeJSON(os.Stdout, rpcError(id, -32602, "Invalid params", map[string]any{"issues": []any{err.Error()}}))
				continue
			}
			var syntax *json.SyntaxError
			if errors.As(err, &syntax) {
				_ = writeJSON(os.Stdout, rpcError(id, -32602, "Invalid params", map[string]any{"issues": []any{err.Error()}}))
				continue
			}
			_ = writeJSON(os.Stdout, rpcError(id, -32603, err.Error(), nil))
			continue
		}
		_ = writeJSON(os.Stdout, rpcSuccess(id, result))
	}
	return 0
}

var errMethodNotFound = errors.New("method not found")
var errInvalidParams = errors.New("invalid params")

func (m MCP) dispatch(method string, params any) (any, error) {
	switch method {
	case "initialize":
		return map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "logbook", "version": Version},
			"instructions":    agentInstructions,
		}, nil
	case "tools/list":
		return map[string]any{"tools": toolsList()}, nil
	case "tools/call":
		raw, _ := params.(map[string]any)
		name, _ := raw["name"].(string)
		args, _ := raw["arguments"]
		result, err := m.dispatch(name, args)
		if err != nil {
			return nil, err
		}
		return map[string]any{"content": []map[string]any{{"type": "text", "text": mustJSON(result)}}}, nil
	case "list_tasks":
		return m.handleListTasks(params)
	case "current_task":
		task, err := CurrentTask(m.SessionID, m.Layer.Repo, m.Layer.Registry)
		if err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	case "create_task":
		input, err := parseCreateTaskParams(params)
		if err != nil {
			return nil, err
		}
		task, err := CreateTask(input, m.SessionID)
		if err != nil {
			return nil, err
		}
		if err := m.Layer.Repo.Save(task); err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	case "update_task":
		id, status, comment, err := parseUpdateTaskParams(params)
		if err != nil {
			return nil, err
		}
		if err := UpdateTask(id, status, comment, m.SessionID, m.Layer.Repo, m.Layer.Registry, layerHooks(m.Layer)); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "edit_task":
		input, err := parseEditTaskParams(params)
		if err != nil {
			return nil, err
		}
		task, err := EditTask(input.ID, input.Updates, m.Layer.Repo)
		if err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	default:
		return nil, errMethodNotFound
	}
}

func (m MCP) handleListTasks(params any) (any, error) {
	raw, _ := params.(map[string]any)
	status := StatusInProgress
	if s, ok := raw["status"].(string); ok && s != "" {
		status = Status(s)
	}
	if statusStr, ok := raw["status"].(string); ok && statusStr == "*" {
		status = Status("*")
	}
	if status != "*" && !status.Valid() {
		return nil, errInvalidParams
	}
	opts := ListTasksOptions{Status: status}
	if v, ok := raw["project"].(string); ok {
		opts.Project = v
	}
	if v, ok := raw["milestone"].(string); ok {
		opts.Milestone = v
	}
	tasks, err := ListTasks(m.Layer.Repo, opts)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tasks": tasks}, nil
}

func parseCreateTaskParams(params any) (CreateTaskInput, error) {
	raw, _ := params.(map[string]any)
	project, _ := raw["project"].(string)
	milestone, _ := raw["milestone"].(string)
	title, _ := raw["title"].(string)
	dod := parseAnyStringList(raw["definition_of_done"])
	testCases := parseAnyStringList(raw["test_cases"])
	description, _ := raw["description"].(string)
	pkt, _ := asInt(raw["predictedKTokens"])
	priority, _ := asInt(raw["priority"])
	if project == "" || milestone == "" || title == "" || len(dod) == 0 || description == "" || pkt <= 0 {
		return CreateTaskInput{}, errInvalidParams
	}
	if priority < 0 {
		return CreateTaskInput{}, errInvalidParams
	}
	return CreateTaskInput{Project: project, Milestone: milestone, Title: title, DefinitionOfDone: dod, TestCases: testCases, Description: description, PredictedKTokens: pkt, Priority: priority}, nil
}

func parseUpdateTaskParams(params any) (string, Status, *Comment, error) {
	raw, _ := params.(map[string]any)
	id, _ := raw["id"].(string)
	ns, _ := raw["new_status"].(string)
	if id == "" || ns == "" {
		return "", "", nil, errInvalidParams
	}
	if !Status(ns).Valid() {
		return "", "", nil, errInvalidParams
	}
	var comment *Comment
	if c, ok := raw["comment"].(map[string]any); ok {
		kind, _ := c["kind"].(string)
		if kind == "" {
			kind = "regular"
		}
		if kind != string(CommentKindNeedInfo) && kind != string(CommentKindRegular) {
			return "", "", nil, errInvalidParams
		}
		title, _ := c["title"].(string)
		if title == "" {
			return "", "", nil, errInvalidParams
		}
		content, _ := c["content"].(string)
		reply, _ := c["reply"].(string)
		comment = &Comment{
			ID:        newUUID(),
			Timestamp: NewJSONTime(timeNow()),
			Title:     title,
			Content:   content,
			Reply:     reply,
			Kind:      CommentKind(kind),
		}
		if idv, ok := c["id"].(string); ok && idv != "" {
			if !isUUID(idv) {
				return "", "", nil, errInvalidParams
			}
			comment.ID = idv
		}
	}
	return id, Status(ns), comment, nil
}

func parseEditTaskParams(params any) (struct {
	ID      string
	Updates EditTaskInput
}, error) {
	raw, _ := params.(map[string]any)
	id, _ := raw["id"].(string)
	if id == "" {
		return struct {
			ID      string
			Updates EditTaskInput
		}{}, errInvalidParams
	}
	var updates EditTaskInput
	if v, ok := raw["title"].(string); ok {
		updates.Title = &v
	}
	if v, ok := raw["description"].(string); ok {
		updates.Description = &v
	}
	if v, ok := raw["definition_of_done"]; ok {
		values := parseAnyStringList(v)
		updates.DefinitionOfDoD = &values
	}
	if v, ok := raw["test_cases"]; ok {
		values := parseAnyStringList(v)
		updates.TestCases = &values
	}
	if v, ok := asInt(raw["predictedKTokens"]); ok {
		if v <= 0 {
			return struct {
				ID      string
				Updates EditTaskInput
			}{}, errInvalidParams
		}
		updates.PredictedKTokens = &v
	}
	if v, ok := asInt(raw["priority"]); ok {
		if v < 0 {
			return struct {
				ID      string
				Updates EditTaskInput
			}{}, errInvalidParams
		}
		updates.Priority = &v
	}
	return struct {
		ID      string
		Updates EditTaskInput
	}{ID: id, Updates: updates}, nil
}

func toolsList() []map[string]any {
	statusEnum := []string{"backlog", "todo", "need_info", "blocked", "in_progress", "pending_review", "done"}
	return []map[string]any{
		{"name": "list_tasks", "description": "List tasks, optionally filtered by status. Defaults to in_progress.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"status": map[string]any{"oneOf": []any{map[string]any{"type": "string", "enum": statusEnum}, map[string]any{"type": "string", "enum": []string{"*"}}}, "description": "Status filter. Use '*' for all tasks. Defaults to 'in_progress'."}}}},
		{"name": "current_task", "description": "Return the highest-priority in_progress task for this session. Call this at session start before doing any work.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
		{"name": "create_task", "description": "Create a new task in backlog. Set predictedKTokens to your estimated context use — this drives the Fibonacci estimation and model selection for sub-agents.", "inputSchema": map[string]any{"type": "object", "required": []string{"project", "milestone", "title", "definition_of_done", "description", "predictedKTokens"}, "properties": map[string]any{"project": map[string]any{"type": "string"}, "milestone": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "definition_of_done": map[string]any{"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}}, "test_cases": map[string]any{"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}}, "description": map[string]any{"type": "string"}, "predictedKTokens": map[string]any{"type": "number"}}}},
		{"name": "update_task", "description": "Transition a task's status. Attach a comment when moving to pending_review. Use need_info or blocked for side-exits from in_progress.", "inputSchema": map[string]any{"type": "object", "required": []string{"id", "new_status"}, "properties": map[string]any{"id": map[string]any{"type": "string"}, "new_status": map[string]any{"type": "string", "enum": statusEnum}, "comment": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string", "format": "uuid", "description": "Existing comment id — provide only when replying to a need_info comment."}, "title": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}, "reply": map[string]any{"type": "string", "description": "Reply text — only meaningful when id refers to a need_info comment."}, "kind": map[string]any{"type": "string", "enum": []string{"need_info", "regular"}}}}}}},
		{"name": "edit_task", "description": "Edit mutable fields of a task without changing its status.", "inputSchema": map[string]any{"type": "object", "required": []string{"id"}, "properties": map[string]any{"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "description": map[string]any{"type": "string"}, "definition_of_done": map[string]any{"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}}, "test_cases": map[string]any{"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}}, "predictedKTokens": map[string]any{"type": "number"}}}},
	}
}

func rpcSuccess(id any, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcError(id any, code int, message string, data any) map[string]any {
	errObj := map[string]any{"code": code, "message": message}
	if data != nil {
		errObj["data"] = data
	}
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": errObj}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func asInt(v any) (int, bool) {
	switch x := v.(type) {
	case int:
		return x, true
	case int64:
		return int(x), true
	case float64:
		return int(x), true
	case json.Number:
		n, err := x.Int64()
		return int(n), err == nil
	default:
		return 0, false
	}
}

func parseAnyStringList(v any) []string {
	switch x := v.(type) {
	case string:
		return parseStringList(x)
	case []any:
		out := make([]string, 0, len(x))
		for _, item := range x {
			s, _ := item.(string)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(x))
		for _, item := range x {
			if item != "" {
				out = append(out, item)
			}
		}
		return out
	default:
		return []string{}
	}
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
				return false
			}
		}
	}
	return true
}

const agentInstructions = `You are connected to the logbook MCP server. You MUST use it to track all tasks in this session.

## Session start
Call ` + "`current_task`" + ` immediately. If it returns ` + "`no_current_task`" + `, pick a task from ` + "`list_tasks`" + ` with status ` + "`todo`" + ` and move it to ` + "`in_progress`" + `, or create a new one with ` + "`create_task`" + ` then advance it: backlog → todo → in_progress.

## Task lifecycle
backlog → todo → in_progress → pending_review → done
Side-exits from in_progress: → need_info (awaiting clarification) or → blocked (external dependency). Return to in_progress once resolved.
Always attach a comment when moving to pending_review.
`
