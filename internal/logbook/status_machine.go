package logbook

import "strings"

func GuardTransition(from, to Status, taskID string) error {
	if from == to {
		return nil
	}
	allowed := map[Status][]Status{
		StatusBacklog:       {StatusTodo},
		StatusTodo:          {StatusBacklog, StatusInProgress},
		StatusInProgress:    {StatusTodo, StatusPendingReview, StatusNeedInfo, StatusBlocked},
		StatusBlocked:       {StatusInProgress},
		StatusNeedInfo:      {StatusInProgress},
		StatusPendingReview: {StatusDone, StatusInProgress},
		StatusDone:          {},
	}
	for _, next := range allowed[from] {
		if next == to {
			return nil
		}
	}
	if from == StatusInProgress && to == StatusDone && strings.HasPrefix(taskID, "review-") {
		return nil
	}
	return TaskError{Tag: "transition_not_allowed", From: from, To: to, TaskID: taskID}
}
