package logbook

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type JSONLTaskRepository struct {
	Path string
}

func (r JSONLTaskRepository) Save(task Task) error {
	content, err := readFileOrEmpty(r.Path)
	if err != nil {
		return err
	}
	for _, line := range splitLines(content) {
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			if id, ok := raw["id"].(string); ok && id == task.ID {
				return TaskError{Tag: "conflict", TaskID: task.ID}
			}
		}
	}
	f, err := os.OpenFile(r.Path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}
	_, err = f.Write(append(data, '\n'))
	return err
}

func (r JSONLTaskRepository) Update(task Task) error {
	content, err := readFileOrEmpty(r.Path)
	if err != nil {
		return err
	}
	lines := splitLines(content)
	found := false
	updated := make([]string, 0, len(lines))
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}
	for _, line := range lines {
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			if id, ok := raw["id"].(string); ok && id == task.ID {
				found = true
				updated = append(updated, string(data))
				continue
			}
		}
		updated = append(updated, line)
	}
	if !found {
		return TaskError{Tag: "not_found", TaskID: task.ID}
	}
	tmpPath := r.Path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(r.Path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(tmpPath, []byte(joinLines(updated)), 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, r.Path)
}

func (r JSONLTaskRepository) FindByID(id string) (Task, error) {
	content, err := readFileOrEmpty(r.Path)
	if err != nil {
		return Task{}, err
	}
	for _, line := range splitLines(content) {
		task, err := parseTaskLine(line)
		if err != nil {
			continue
		}
		if task.ID == id {
			return task, nil
		}
	}
	return Task{}, TaskError{Tag: "not_found", TaskID: id}
}

func (r JSONLTaskRepository) FindByStatus(status Status) ([]Task, error) {
	return r.findByStatus(status)
}

func (r JSONLTaskRepository) findByStatus(status Status) ([]Task, error) {
	content, err := readFileOrEmpty(r.Path)
	if err != nil {
		return nil, err
	}
	var tasks []Task
	for _, line := range splitLines(content) {
		task, err := parseTaskLine(line)
		if err != nil {
			return nil, TaskError{Tag: "validation_error", Message: err.Error()}
		}
		if status == "*" || task.Status == status {
			tasks = append(tasks, task)
		}
	}
	return tasks, nil
}

func parseTaskLine(line string) (Task, error) {
	var task Task
	if err := json.Unmarshal([]byte(line), &task); err != nil {
		return Task{}, err
	}
	if err := validateTask(task); err != nil {
		return Task{}, err
	}
	return task, nil
}

func validateTask(task Task) error {
	if task.Project == "" || task.Milestone == "" || task.ID == "" || task.Title == "" || task.DefinitionOfDoD == "" || task.Description == "" {
		return errors.New("task validation failed")
	}
	if task.Estimation <= 0 {
		return errors.New("task validation failed")
	}
	if !task.Status.Valid() {
		return errors.New("task validation failed")
	}
	if task.Priority < 0 {
		return errors.New("task validation failed")
	}
	if task.Comments == nil {
		return errors.New("task validation failed")
	}
	for _, c := range task.Comments {
		if err := validateComment(c); err != nil {
			return err
		}
	}
	if task.Assignee != nil {
		if task.Assignee.ID == "" || task.Assignee.Title == "" {
			return errors.New("task validation failed")
		}
	}
	if task.InProgressSince != nil && task.Status != StatusInProgress {
		// keep permissive to match existing behavior
	}
	return nil
}

func validateComment(c Comment) error {
	if c.ID == "" || c.Title == "" || !c.Kind.Valid() {
		return errors.New("task validation failed")
	}
	return nil
}

func joinLines(lines []string) string {
	if len(lines) == 0 {
		return "\n"
	}
	out := ""
	for i, line := range lines {
		if i > 0 {
			out += "\n"
		}
		out += line
	}
	out += "\n"
	return out
}
