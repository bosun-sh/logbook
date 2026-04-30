package logbook

import (
	"fmt"
	"sort"
	"time"
)

type Layer struct {
	Repo     JSONLTaskRepository
	Registry PidSessionRegistry
	Hooks    []HookConfig
}

func CreateTask(input CreateTaskInput) (Task, error) {
	required := []struct {
		field string
		value string
	}{
		{field: "project", value: input.Project},
		{field: "milestone", value: input.Milestone},
		{field: "title", value: input.Title},
		{field: "definition_of_done", value: input.DefinitionOfDone},
		{field: "description", value: input.Description},
	}
	for _, item := range required {
		if item.value == "" {
			return Task{}, TaskError{Tag: "validation_error", Message: fmt.Sprintf("%s is required", item.field)}
		}
	}
	estimation, err := EstimateFromKTokens(input.PredictedKTokens)
	if err != nil {
		return Task{}, err
	}
	task := Task{
		Project:         input.Project,
		Milestone:       input.Milestone,
		ID:              newUUID(),
		Title:           input.Title,
		DefinitionOfDoD: input.DefinitionOfDone,
		Description:     input.Description,
		Estimation:      estimation,
		Comments:        []Comment{},
		Status:          StatusBacklog,
		Priority:        input.Priority,
	}
	if input.Priority < 0 {
		task.Priority = 0
	}
	return task, nil
}

type CreateTaskInput struct {
	Project          string
	Milestone        string
	Title            string
	DefinitionOfDone string
	Description      string
	PredictedKTokens int
	Priority         int
}

type ListTasksOptions struct {
	Status    Status
	Project   string
	Milestone string
}

func ListTasks(repo JSONLTaskRepository, options ListTasksOptions) ([]Task, error) {
	tasks, err := repo.FindByStatus(options.Status)
	if err != nil {
		return nil, err
	}
	filtered := make([]Task, 0, len(tasks))
	for _, task := range tasks {
		if options.Project != "" && task.Project != options.Project {
			continue
		}
		if options.Milestone != "" && task.Milestone != options.Milestone {
			continue
		}
		filtered = append(filtered, task)
	}
	sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].Priority > filtered[j].Priority })
	return filtered, nil
}

func pickHighestPriority(tasks []Task) Task {
	sorted := append([]Task(nil), tasks...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Priority != sorted[j].Priority {
			return sorted[i].Priority > sorted[j].Priority
		}
		ai := timeIndex(sorted[i].InProgressSince)
		aj := timeIndex(sorted[j].InProgressSince)
		return ai < aj
	})
	return sorted[0]
}

func timeIndex(t *JSONTime) int64 {
	if t == nil {
		return int64(^uint64(0) >> 1)
	}
	return t.UnixNano()
}

func CurrentTask(sessionID string, repo JSONLTaskRepository, registry PidSessionRegistry) (Task, error) {
	inProgress, err := repo.FindByStatus(StatusInProgress)
	if err != nil {
		return Task{}, err
	}
	own := make([]Task, 0)
	for _, task := range inProgress {
		if task.Assignee != nil && task.Assignee.ID == sessionID {
			own = append(own, task)
		}
	}
	if len(own) > 0 {
		return pickHighestPriority(own), nil
	}
	if claimed, ok := stepUnassigned(inProgress, sessionID, repo); ok {
		return claimed, nil
	}
	if claimed, ok := stepOrphan(sessionID, inProgress, repo, registry); ok {
		return claimed, nil
	}
	return stepTodo(sessionID, repo)
}

func stepUnassigned(inProgress []Task, sessionID string, repo JSONLTaskRepository) (Task, bool) {
	unassigned := make([]Task, 0)
	for _, t := range inProgress {
		if t.Assignee == nil {
			unassigned = append(unassigned, t)
		}
	}
	if len(unassigned) == 0 {
		return Task{}, false
	}
	oldest := pickHighestPriority(unassigned)
	claimed := oldest.Clone()
	claimed.Assignee = &Agent{ID: sessionID, Title: "Agent", Description: ""}
	_ = repo.Update(claimed)
	return claimed, true
}

func stepOrphan(sessionID string, candidates []Task, repo JSONLTaskRepository, registry PidSessionRegistry) (Task, bool) {
	orphans := make([]Task, 0)
	for _, t := range candidates {
		if t.Assignee != nil && t.Assignee.ID != sessionID && !registry.IsAlive(t.Assignee.ID) {
			orphans = append(orphans, t)
		}
	}
	if len(orphans) == 0 {
		return Task{}, false
	}
	oldest := pickHighestPriority(orphans)
	claimed := oldest.Clone()
	if claimed.Assignee != nil {
		claimed.Assignee.ID = sessionID
	}
	_ = repo.Update(claimed)
	return claimed, true
}

func stepTodo(sessionID string, repo JSONLTaskRepository) (Task, error) {
	todos, err := repo.FindByStatus(StatusTodo)
	if err != nil {
		return Task{}, err
	}
	if len(todos) == 0 {
		return Task{}, TaskError{Tag: "no_current_task"}
	}
	sort.SliceStable(todos, func(i, j int) bool { return todos[i].Priority > todos[j].Priority })
	best := todos[0].Clone()
	best.Status = StatusInProgress
	if best.Assignee == nil {
		best.Assignee = &Agent{ID: sessionID, Title: "Agent", Description: ""}
	} else {
		best.Assignee.ID = sessionID
	}
	now := NewJSONTime(time.Now().UTC())
	best.InProgressSince = &now
	if err := repo.Update(best); err != nil {
		return Task{}, err
	}
	return best, nil
}

type CommentInput struct {
	ID      string
	Title   string
	Content string
	Reply   string
	Kind    CommentKind
}

func UpdateTask(id string, newStatus Status, comment *Comment, sessionID string, repo JSONLTaskRepository, registry PidSessionRegistry, hookRunner HookRunner) error {
	task, err := repo.FindByID(id)
	if err != nil {
		return err
	}
	if err := GuardTransition(task.Status, newStatus, task.ID); err != nil {
		return err
	}
	if comment != nil {
		for i := range task.Comments {
			if task.Comments[i].ID == comment.ID {
				if task.Comments[i].Kind == CommentKindRegular {
					return TaskError{Tag: "validation_error", Message: "reply is only valid on need_info comments", Context: map[string]any{"commentId": task.Comments[i].ID, "commentKind": task.Comments[i].Kind}}
				}
				updated := task.Clone()
				updated.Comments[i].Reply = comment.Reply
				return repo.Update(updated)
			}
		}
	}
	if task.Status == newStatus {
		return nil
	}
	if newStatus == StatusNeedInfo && comment == nil {
		return TaskError{Tag: "missing_comment", From: task.Status, To: newStatus}
	}
	if newStatus == StatusBlocked {
		if comment == nil {
			return TaskError{Tag: "missing_comment", From: task.Status, To: newStatus}
		}
		if stringsTrimSpace(comment.Content) == "" {
			return TaskError{Tag: "validation_error", Message: "blocked requires a non-empty comment", Context: map[string]any{"from": task.Status, "to": newStatus}}
		}
	}
	if task.Status == StatusNeedInfo {
		for _, c := range task.Comments {
			if c.Kind == CommentKindNeedInfo && c.Reply == "" {
				return TaskError{Tag: "validation_error", Message: "blocking comment " + c.ID + " has no reply", Context: map[string]any{"commentId": c.ID, "commentTitle": c.Title, "commentContent": c.Content, "commentTimestamp": c.Timestamp.Time}}
			}
		}
	}
	if newStatus == StatusInProgress && task.Assignee != nil && task.Assignee.ID != sessionID {
		if registry.IsAlive(task.Assignee.ID) {
			return TaskError{Tag: "validation_error", Message: fmt.Sprintf("task is owned by an active session (%s)", task.Assignee.ID), Context: map[string]any{"task": task}}
		}
	}
	if newStatus == StatusInProgress {
		inProgress, err := repo.FindByStatus(StatusInProgress)
		if err != nil {
			return err
		}
		existing := make([]Task, 0)
		for _, t := range inProgress {
			if t.Assignee != nil && t.Assignee.ID == sessionID && t.ID != task.ID {
				existing = append(existing, t)
			}
		}
		if len(existing) > 0 && (comment == nil || stringsTrimSpace(comment.Content) == "") {
			return TaskError{Tag: "validation_error", Message: "moving a second task to in_progress requires a justification comment", Context: map[string]any{"inProgressTasks": mapTasks(existing)}}
		}
	}
	updated := task.Clone()
	updated.Status = newStatus
	if comment != nil {
		updated.Comments = append(updated.Comments, *comment)
	}
	if newStatus == StatusInProgress {
		now := NewJSONTime(time.Now().UTC())
		updated.InProgressSince = &now
		if updated.Assignee == nil {
			updated.Assignee = &Agent{ID: sessionID, Title: "Agent", Description: ""}
		} else {
			updated.Assignee = &Agent{ID: sessionID, Title: updated.Assignee.Title, Description: updated.Assignee.Description}
		}
	}
	if err := repo.Update(updated); err != nil {
		return err
	}
	if hookRunner != nil {
		_ = hookRunner.Run(HookEvent{TaskID: id, OldStatus: task.Status, NewStatus: newStatus, Comment: comment, SessionID: sessionID})
	}
	return nil
}

func mapTasks(tasks []Task) []map[string]any {
	out := make([]map[string]any, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, map[string]any{"id": t.ID, "title": t.Title})
	}
	return out
}

func EditTask(id string, updates EditTaskInput, repo JSONLTaskRepository) (Task, error) {
	if updates.Status != nil {
		return Task{}, TaskError{Tag: "validation_error", Message: "status field cannot be edited"}
	}
	task, err := repo.FindByID(id)
	if err != nil {
		return Task{}, err
	}
	updated := task.Clone()
	if updates.Title != nil {
		updated.Title = *updates.Title
	}
	if updates.Description != nil {
		updated.Description = *updates.Description
	}
	if updates.DefinitionOfDoD != nil {
		updated.DefinitionOfDoD = *updates.DefinitionOfDoD
	}
	if updates.Priority != nil {
		if *updates.Priority < 0 {
			return Task{}, TaskError{Tag: "validation_error", Message: "priority must be non-negative"}
		}
		updated.Priority = *updates.Priority
	}
	if updates.PredictedKTokens != nil {
		estimation, err := EstimateFromKTokens(*updates.PredictedKTokens)
		if err != nil {
			return Task{}, err
		}
		updated.Estimation = estimation
	}
	if err := repo.Update(updated); err != nil {
		return Task{}, err
	}
	return updated, nil
}

type EditTaskInput struct {
	Title            *string
	Description      *string
	DefinitionOfDoD  *string
	PredictedKTokens *int
	Priority         *int
	Status           *Status
}

func stringsTrimSpace(s string) string {
	i := 0
	j := len(s)
	for i < j && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	for j > i && (s[j-1] == ' ' || s[j-1] == '\t' || s[j-1] == '\n' || s[j-1] == '\r') {
		j--
	}
	return s[i:j]
}
