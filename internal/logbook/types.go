package logbook

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Status string

const (
	StatusBacklog       Status = "backlog"
	StatusTodo          Status = "todo"
	StatusNeedInfo      Status = "need_info"
	StatusBlocked       Status = "blocked"
	StatusInProgress    Status = "in_progress"
	StatusPendingReview Status = "pending_review"
	StatusDone          Status = "done"
)

func (s Status) Valid() bool {
	switch s {
	case StatusBacklog, StatusTodo, StatusNeedInfo, StatusBlocked, StatusInProgress, StatusPendingReview, StatusDone:
		return true
	default:
		return false
	}
}

type CommentKind string

const (
	CommentKindNeedInfo CommentKind = "need_info"
	CommentKindRegular  CommentKind = "regular"
)

func (k CommentKind) Valid() bool {
	return k == CommentKindNeedInfo || k == CommentKindRegular
}

type JSONTime struct {
	time.Time
}

func NewJSONTime(t time.Time) JSONTime {
	return JSONTime{Time: t.UTC()}
}

func (t JSONTime) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.UTC().Format("2006-01-02T15:04:05.000Z"))
}

func (t *JSONTime) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw == "" {
		return errors.New("invalid empty time")
	}
	parsed, err := parseJSONTime(raw)
	if err != nil {
		return err
	}
	t.Time = parsed.UTC()
	return nil
}

func parseJSONTime(raw string) (time.Time, error) {
	layouts := []string{
		"2006-01-02T15:04:05.000Z",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time: %q", raw)
}

type Comment struct {
	ID        string      `json:"id"`
	Timestamp JSONTime    `json:"timestamp"`
	Title     string      `json:"title"`
	Content   string      `json:"content"`
	Reply     string      `json:"reply"`
	Kind      CommentKind `json:"kind"`
}

type Agent struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type Task struct {
	Project         string    `json:"project"`
	Milestone       string    `json:"milestone"`
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	DefinitionOfDoD string    `json:"definition_of_done"`
	Description     string    `json:"description"`
	Estimation      int       `json:"estimation"`
	Comments        []Comment `json:"comments"`
	Assignee        *Agent    `json:"assignee,omitempty"`
	Status          Status    `json:"status"`
	InProgressSince *JSONTime `json:"in_progress_since,omitempty"`
	Priority        int       `json:"priority"`
}

func (t Task) Clone() Task {
	cp := t
	if t.Assignee != nil {
		agent := *t.Assignee
		cp.Assignee = &agent
	}
	if t.InProgressSince != nil {
		ts := *t.InProgressSince
		cp.InProgressSince = &ts
	}
	if t.Comments != nil {
		cp.Comments = append([]Comment(nil), t.Comments...)
	}
	return cp
}

type TaskError struct {
	Tag     string         `json:"_tag"`
	TaskID  string         `json:"taskId,omitempty"`
	From    Status         `json:"from,omitempty"`
	To      Status         `json:"to,omitempty"`
	Message string         `json:"message,omitempty"`
	Context map[string]any `json:"context,omitempty"`
}

func (e TaskError) Error() string {
	switch e.Tag {
	case "not_found":
		return "task not found"
	case "transition_not_allowed":
		return fmt.Sprintf("transition not allowed: %s -> %s", e.From, e.To)
	case "validation_error":
		return e.Message
	case "missing_comment":
		return "missing comment"
	case "conflict":
		return "task already exists"
	case "no_current_task":
		return "no current task for this session"
	default:
		return "task error"
	}
}

func IsTaskError(err error) (TaskError, bool) {
	var te TaskError
	if errors.As(err, &te) {
		return te, true
	}
	var pte *TaskError
	if errors.As(err, &pte) && pte != nil {
		return *pte, true
	}
	return TaskError{}, false
}
