package logbook

import (
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
)

type PidSessionRegistry struct {
	sessionsFile string
}

func NewPidSessionRegistry(tasksFile string) PidSessionRegistry {
	return PidSessionRegistry{sessionsFile: filepath.Join(filepath.Dir(tasksFile), "sessions.json")}
}

func (r PidSessionRegistry) IsAlive(sessionID string) bool {
	m := r.readMap()
	pid, ok := m[sessionID]
	if !ok {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		r.removeEntry(sessionID)
		return false
	}
	if err := proc.Signal(syscall.Signal(0)); err != nil {
		r.removeEntry(sessionID)
		return false
	}
	return true
}

func (r PidSessionRegistry) Register(sessionID string, pid int) error {
	m := r.readMap()
	m[sessionID] = pid
	return r.writeMap(m)
}

func (r PidSessionRegistry) Deregister(sessionID string) error {
	return r.removeEntry(sessionID)
}

func (r PidSessionRegistry) readMap() map[string]int {
	raw, err := os.ReadFile(r.sessionsFile)
	if err != nil {
		return map[string]int{}
	}
	m := map[string]int{}
	_ = json.Unmarshal(raw, &m)
	return m
}

func (r PidSessionRegistry) writeMap(m map[string]int) error {
	if err := os.MkdirAll(filepath.Dir(r.sessionsFile), 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return os.WriteFile(r.sessionsFile, raw, 0o644)
}

func (r PidSessionRegistry) removeEntry(sessionID string) error {
	m := r.readMap()
	delete(m, sessionID)
	return r.writeMap(m)
}
