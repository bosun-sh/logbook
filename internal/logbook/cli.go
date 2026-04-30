package logbook

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Version = "1.0.0"

type CLI struct {
	TasksFile string
	HooksDir  string
	SessionID string
}

func RunCLI(args []string, env map[string]string) int {
	cli := CLI{
		TasksFile: getenv(env, "LOGBOOK_TASKS_FILE", "./tasks.jsonl"),
		HooksDir:  getenv(env, "LOGBOOK_HOOKS_DIR", "./hooks"),
		SessionID: getenv(env, "LOGBOOK_SESSION_ID", ""),
	}
	command, commandArgs := parseCLIArgs(args, &cli)
	if command == "" {
		printCLIHelp()
		return 0
	}
	if command == "init" {
		if err := RunInit(".", commandArgs["force"] == "true"); err != nil {
			outputCLIError(err)
			return 1
		}
		_ = writeJSON(os.Stdout, map[string]any{"ok": true})
		return 0
	}
	sessionID, err := cli.getOrCreateSession()
	if err != nil {
		outputCLIError(err)
		return 1
	}
	registry := NewPidSessionRegistry(cli.TasksFile)
	if !hasExplicitSession(env) {
		_ = registry.Deregister(sessionID)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		_ = registry.Deregister(sessionID)
		os.Exit(0)
	}()
	layer, err := NewLayer(cli.TasksFile, cli.HooksDir)
	if err != nil {
		outputCLIError(err)
		return 1
	}
	result, runErr := dispatchCommand(command, commandArgs, sessionID, layer, cli)
	if runErr != nil {
		outputCLIError(runErr)
		return 1
	}
	if err := writeJSON(os.Stdout, map[string]any{"ok": true, "result": result}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func getenv(env map[string]string, key, fallback string) string {
	if v := env[key]; v != "" {
		return v
	}
	return fallback
}

func hasExplicitSession(env map[string]string) bool {
	_, ok := env["LOGBOOK_SESSION_ID"]
	return ok
}

func (cli *CLI) getOrCreateSession() (string, error) {
	if cli.SessionID != "" {
		return cli.SessionID, nil
	}
	const file = ".logbook-session"
	if b, err := os.ReadFile(file); err == nil {
		var raw struct {
			SessionID string `json:"sessionId"`
		}
		if json.Unmarshal(b, &raw) == nil && raw.SessionID != "" {
			return raw.SessionID, nil
		}
	}
	session := newUUID()
	if err := os.WriteFile(file, []byte(`{"sessionId":"`+session+`"}`), 0o644); err != nil {
		return "", err
	}
	return session, nil
}

func parseCLIArgs(args []string, cli *CLI) (string, map[string]string) {
	command := ""
	commandArgs := map[string]string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "--tasks-file":
			if i+1 < len(args) {
				cli.TasksFile = args[i+1]
				i++
			}
		case "--hooks-dir":
			if i+1 < len(args) {
				cli.HooksDir = args[i+1]
				i++
			}
		case "--session":
			if i+1 < len(args) {
				cli.SessionID = args[i+1]
				i++
			}
		case "--version", "-v":
			fmt.Println(Version)
			os.Exit(0)
		case "--help", "-h":
			printCLIHelp()
			os.Exit(0)
		default:
			if command == "" && !strings.HasPrefix(arg, "-") {
				command = arg
				for j := i + 1; j < len(args); j++ {
					cmdArg := args[j]
					if strings.HasPrefix(cmdArg, "--") && strings.Contains(cmdArg, "=") {
						key, value, _ := strings.Cut(cmdArg[2:], "=")
						commandArgs[key] = value
					} else if strings.HasPrefix(cmdArg, "--") && j+1 < len(args) && !strings.HasPrefix(args[j+1], "-") {
						commandArgs[cmdArg[2:]] = args[j+1]
						j++
					} else if strings.HasPrefix(cmdArg, "-") && (j+1 >= len(args) || strings.HasPrefix(args[j+1], "-")) {
						commandArgs[cmdArg[2:]] = "true"
					}
				}
				return command, commandArgs
			}
		}
	}
	return command, commandArgs
}

func printCLIHelp() {
	fmt.Println("logbook <command> [options]")
	fmt.Println()
	fmt.Println("Commands: create-task, list-tasks, current-task, update-task, edit-task, init")
	fmt.Println("Use logbook <command> --help for command-specific usage.")
}

func dispatchCommand(command string, commandArgs map[string]string, sessionID string, layer Layer, cli CLI) (any, error) {
	repo := layer.Repo
	registry := layer.Registry
	switch command {
	case "create-task":
		input, err := parseCreateTaskInput(commandArgs)
		if err != nil {
			return nil, err
		}
		task, err := CreateTask(input)
		if err != nil {
			return nil, err
		}
		if err := repo.Save(task); err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	case "list-tasks":
		opts, err := parseListTasksOptions(commandArgs)
		if err != nil {
			return nil, err
		}
		tasks, err := ListTasks(repo, opts)
		if err != nil {
			return nil, err
		}
		return map[string]any{"tasks": tasks}, nil
	case "current-task":
		task, err := CurrentTask(sessionID, repo, registry)
		if err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	case "update-task":
		input, err := parseUpdateTaskInput(commandArgs)
		if err != nil {
			return nil, err
		}
		var comment *Comment
		if input.Comment != nil {
			comment = input.Comment
		}
		if err := UpdateTask(input.ID, input.NewStatus, comment, sessionID, repo, registry, layerHooks(layer)); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "edit-task":
		input, err := parseEditTaskInput(commandArgs)
		if err != nil {
			return nil, err
		}
		task, err := EditTask(input.ID, input.Updates, repo)
		if err != nil {
			return nil, err
		}
		return map[string]any{"task": task}, nil
	default:
		return nil, fmt.Errorf("unknown command: %s", command)
	}
}

func parseCreateTaskInput(args map[string]string) (CreateTaskInput, error) {
	pkt, err := strconv.Atoi(args["predicted-k-tokens"])
	if err != nil || pkt == 0 {
		return CreateTaskInput{}, errors.New("Missing required arguments: project, milestone, title, definition-of-done, description, predicted-k-tokens")
	}
	priority, _ := strconv.Atoi(args["priority"])
	if args["priority"] != "" {
		priority, _ = strconv.Atoi(args["priority"])
	}
	if args["project"] == "" || args["milestone"] == "" || args["title"] == "" || args["definition-of-done"] == "" || args["description"] == "" {
		return CreateTaskInput{}, errors.New("Missing required arguments: project, milestone, title, definition-of-done, description, predicted-k-tokens")
	}
	return CreateTaskInput{
		Project:          args["project"],
		Milestone:        args["milestone"],
		Title:            args["title"],
		DefinitionOfDone: args["definition-of-done"],
		Description:      args["description"],
		PredictedKTokens: pkt,
		Priority:         priority,
	}, nil
}

func parseUpdateTaskInput(args map[string]string) (struct {
	ID        string
	NewStatus Status
	Comment   *Comment
}, error) {
	id := args["id"]
	if id == "" || args["new-status"] == "" {
		return struct {
			ID        string
			NewStatus Status
			Comment   *Comment
		}{}, errors.New("Missing required arguments: id, new-status")
	}
	comment := (*Comment)(nil)
	if args["comment-title"] != "" || args["comment-content"] != "" || args["comment-kind"] != "" {
		kind := CommentKindRegular
		if args["comment-kind"] == "need_info" {
			kind = CommentKindNeedInfo
		}
		ts := NewJSONTime(timeNow())
		comment = &Comment{
			ID:        newUUID(),
			Timestamp: ts,
			Title:     args["comment-title"],
			Content:   args["comment-content"],
			Reply:     "",
			Kind:      kind,
		}
	}
	return struct {
		ID        string
		NewStatus Status
		Comment   *Comment
	}{
		ID:        id,
		NewStatus: Status(args["new-status"]),
		Comment:   comment,
	}, nil
}

func parseEditTaskInput(args map[string]string) (struct {
	ID      string
	Updates EditTaskInput
}, error) {
	id := args["id"]
	if id == "" {
		return struct {
			ID      string
			Updates EditTaskInput
		}{}, errors.New("Missing required argument: id")
	}
	var updates EditTaskInput
	if v, ok := args["title"]; ok && v != "" {
		updates.Title = &v
	}
	if v, ok := args["description"]; ok && v != "" {
		updates.Description = &v
	}
	if v, ok := args["definition-of-done"]; ok && v != "" {
		updates.DefinitionOfDoD = &v
	}
	if v, ok := args["predicted-k-tokens"]; ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return struct {
				ID      string
				Updates EditTaskInput
			}{}, err
		}
		updates.PredictedKTokens = &n
	}
	if v, ok := args["priority"]; ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return struct {
				ID      string
				Updates EditTaskInput
			}{}, err
		}
		updates.Priority = &n
	}
	return struct {
		ID      string
		Updates EditTaskInput
	}{ID: id, Updates: updates}, nil
}

func layerHooks(layer Layer) HookRunner {
	return DefaultHookRunner{Configs: layer.Hooks}
}

func NewLayer(tasksFile, hooksDir string) (Layer, error) {
	configs, err := loadHookConfigs(hooksDir)
	if err != nil {
		return Layer{}, err
	}
	return Layer{
		Repo:     JSONLTaskRepository{Path: tasksFile},
		Registry: NewPidSessionRegistry(tasksFile),
		Hooks:    configs,
	}, nil
}

func writeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func outputCLIError(err error) {
	code := -32603
	message := "Internal error"
	extra := map[string]any{}
	if te, ok := IsTaskError(err); ok {
		mcp := taskErrorToMcpError(te)
		code = mcp.Code
		message = mcp.Message
		extra = mcp.Data
	} else if err != nil {
		message = err.Error()
	}
	_ = writeJSON(os.Stdout, map[string]any{"ok": false, "error": map[string]any{"code": code, "message": message, "data": extra}})
}

func timeNow() time.Time { return time.Now().UTC() }

func parseListTasksOptions(args map[string]string) (ListTasksOptions, error) {
	status := StatusInProgress
	if raw, ok := args["status"]; ok && raw != "" {
		status = Status(raw)
	}
	if raw, ok := args["status"]; ok && raw == "*" {
		status = Status("*")
	}
	if !status.Valid() && status != "*" {
		return ListTasksOptions{}, errors.New("invalid status")
	}
	return ListTasksOptions{
		Status:    status,
		Project:   args["project"],
		Milestone: args["milestone"],
	}, nil
}
