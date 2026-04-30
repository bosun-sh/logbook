package logbook

import (
	"fmt"
	"strings"
)

type McpError struct {
	Code    int
	Message string
	Data    map[string]any
}

func taskErrorToMcpError(err TaskError) McpError {
	switch err.Tag {
	case "not_found":
		return McpError{Code: -32001, Message: "Task not found", Data: map[string]any{"taskId": err.TaskID}}
	case "transition_not_allowed":
		allowed := allowedTransitions(err.From)
		message := fmt.Sprintf("Status transition not allowed: cannot move from '%s' to '%s'.", err.From, err.To)
		data := map[string]any{
			"from":      err.From,
			"to":        err.To,
			"taskId":    err.TaskID,
			"allowedTo": allowed,
			"hint":      "Try transitioning to " + firstAllowed(allowed),
		}
		if strings.HasPrefix(err.TaskID, "review-") {
			data["isReviewTask"] = true
		}
		return McpError{Code: -32002, Message: message, Data: data}
	case "validation_error":
		return McpError{Code: -32003, Message: err.Message, Data: mergeMap(map[string]any{"message": err.Message}, err.Context)}
	case "missing_comment":
		return McpError{Code: -32004, Message: "A comment is required for this transition.", Data: map[string]any{"from": err.From, "to": err.To}}
	case "conflict":
		return McpError{Code: -32005, Message: "Task already exists", Data: map[string]any{"taskId": err.TaskID}}
	case "no_current_task":
		return McpError{Code: -32006, Message: "No current task for this session", Data: map[string]any{}}
	default:
		return McpError{Code: -32603, Message: err.Error(), Data: map[string]any{}}
	}
}

func allowedTransitions(from Status) []Status {
	switch from {
	case StatusBacklog:
		return []Status{StatusTodo}
	case StatusTodo:
		return []Status{StatusBacklog, StatusInProgress}
	case StatusInProgress:
		return []Status{StatusTodo, StatusPendingReview, StatusNeedInfo, StatusBlocked}
	case StatusBlocked, StatusNeedInfo:
		return []Status{StatusInProgress}
	case StatusPendingReview:
		return []Status{StatusDone, StatusInProgress}
	default:
		return nil
	}
}

func firstAllowed(items []Status) string {
	if len(items) == 0 {
		return "none"
	}
	return string(items[0])
}

func mergeMap(base map[string]any, extra map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for k, v := range extra {
		base[k] = v
	}
	return base
}
