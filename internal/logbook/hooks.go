package logbook

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type HookConfig struct {
	Event     string
	Condition string
	TimeoutMS int
	Script    string
}

type HookEvent struct {
	TaskID    string
	OldStatus Status
	NewStatus Status
	Comment   *Comment
	SessionID string
}

type HookRunner interface {
	Run(event HookEvent) error
}

type DefaultHookRunner struct {
	Configs []HookConfig
}

func (r DefaultHookRunner) Run(event HookEvent) error {
	return executeHooks(event, r.Configs)
}

func loadHookConfigs(hooksDir string) ([]HookConfig, error) {
	entries, err := os.ReadDir(hooksDir)
	if err != nil {
		if errorsIs(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var configs []HookConfig
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		hookDir := filepath.Join(hooksDir, entry.Name())
		configPath := filepath.Join(hookDir, "config.yml")
		raw, err := os.ReadFile(configPath)
		if err != nil {
			continue
		}
		parsed := parseSimpleYAML(string(raw))
		event, _ := parsed["event"].(string)
		if event == "" {
			continue
		}
		cfg := HookConfig{Event: event, Script: ""}
		if c, ok := parsed["condition"].(string); ok {
			cfg.Condition = c
		}
		switch t := parsed["timeout_ms"].(type) {
		case int:
			cfg.TimeoutMS = t
		case int64:
			cfg.TimeoutMS = int(t)
		case float64:
			cfg.TimeoutMS = int(t)
		}
		for _, name := range []string{"script.ts", "script.sh"} {
			p := filepath.Join(hookDir, name)
			if _, err := os.Stat(p); err == nil {
				cfg.Script = p
				break
			}
		}
		if cfg.Script == "" {
			continue
		}
		configs = append(configs, cfg)
	}
	return configs, nil
}

func parseSimpleYAML(content string) map[string]any {
	out := map[string]any{}
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		idx := strings.Index(trimmed, ":")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(trimmed[:idx])
		value := strings.TrimSpace(trimmed[idx+1:])
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
			out[key] = value
			continue
		}
		if n, err := strconv.Atoi(value); err == nil {
			out[key] = n
			continue
		}
		out[key] = value
	}
	return out
}

func executeHooks(event HookEvent, configs []HookConfig) error {
	var selected []HookConfig
	for _, cfg := range configs {
		if cfg.Event != "task.status_changed" {
			continue
		}
		if cfg.Condition != "" {
			ok, err := evalCondition(cfg.Condition, event)
			if err != nil || !ok {
				continue
			}
		}
		selected = append(selected, cfg)
	}
	for _, cfg := range selected {
		_ = runHookScript(cfg, event)
	}
	return nil
}

func runHookScript(cfg HookConfig, event HookEvent) error {
	timeout := cfg.TimeoutMS
	if timeout <= 0 {
		timeout = 5000
	}
	var cmd *exec.Cmd
	if strings.HasSuffix(cfg.Script, ".ts") {
		cmd = exec.Command("bun", cfg.Script)
	} else {
		cmd = exec.Command("sh", "-c", cfg.Script)
	}
	cmd.Env = append(os.Environ(),
		"LOGBOOK_TASK_ID="+event.TaskID,
		"LOGBOOK_OLD_STATUS="+string(event.OldStatus),
		"LOGBOOK_NEW_STATUS="+string(event.NewStatus),
		"LOGBOOK_SESSION_ID="+event.SessionID,
	)
	if event.Comment != nil {
		_ = event.Comment
	}
	done := make(chan error, 1)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { done <- cmd.Wait() }()
	select {
	case <-time.After(time.Duration(timeout) * time.Millisecond):
		_ = cmd.Process.Kill()
		<-done
		return nil
	case <-done:
		return nil
	}
}

func evalCondition(expr string, event HookEvent) (bool, error) {
	p := newExprParser(expr, map[string]string{
		"new_status": string(event.NewStatus),
		"old_status": string(event.OldStatus),
		"task_id":    event.TaskID,
		"session_id": event.SessionID,
	})
	return p.parse()
}

type exprParser struct {
	input string
	pos   int
	vars  map[string]string
}

func newExprParser(input string, vars map[string]string) *exprParser {
	return &exprParser{input: input, vars: vars}
}

func (p *exprParser) parse() (bool, error) {
	val, err := p.parseOr()
	if err != nil {
		return false, err
	}
	p.skipSpace()
	if p.pos != len(p.input) {
		return false, fmt.Errorf("unexpected trailing input")
	}
	return val, nil
}

func (p *exprParser) parseOr() (bool, error) {
	left, err := p.parseAnd()
	if err != nil {
		return false, err
	}
	for {
		p.skipSpace()
		if !p.consume("||") {
			return left, nil
		}
		right, err := p.parseAnd()
		if err != nil {
			return false, err
		}
		left = left || right
	}
}

func (p *exprParser) parseAnd() (bool, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return false, err
	}
	for {
		p.skipSpace()
		if !p.consume("&&") {
			return left, nil
		}
		right, err := p.parsePrimary()
		if err != nil {
			return false, err
		}
		left = left && right
	}
}

func (p *exprParser) parsePrimary() (bool, error) {
	p.skipSpace()
	if p.consume("(") {
		val, err := p.parseOr()
		if err != nil {
			return false, err
		}
		p.skipSpace()
		if !p.consume(")") {
			return false, fmt.Errorf("missing )")
		}
		return val, nil
	}
	left, err := p.parseOperand()
	if err != nil {
		return false, err
	}
	p.skipSpace()
	op := ""
	switch {
	case p.consume("==="):
		op = "==="
	case p.consume("=="):
		op = "=="
	case p.consume("!=="):
		op = "!=="
	case p.consume("!="):
		op = "!="
	default:
		return false, fmt.Errorf("expected comparator")
	}
	right, err := p.parseOperand()
	if err != nil {
		return false, err
	}
	switch op {
	case "==", "===":
		return left == right, nil
	case "!=", "!==":
		return left != right, nil
	default:
		return false, fmt.Errorf("unknown comparator")
	}
}

func (p *exprParser) parseOperand() (string, error) {
	p.skipSpace()
	if p.pos >= len(p.input) {
		return "", fmt.Errorf("unexpected end of input")
	}
	switch p.input[p.pos] {
	case '\'', '"':
		quote := p.input[p.pos]
		p.pos++
		start := p.pos
		for p.pos < len(p.input) && p.input[p.pos] != quote {
			p.pos++
		}
		if p.pos >= len(p.input) {
			return "", fmt.Errorf("unterminated string")
		}
		val := p.input[start:p.pos]
		p.pos++
		return val, nil
	default:
		start := p.pos
		for p.pos < len(p.input) && (isIdentChar(p.input[p.pos]) || p.input[p.pos] == '.') {
			p.pos++
		}
		token := strings.TrimSpace(p.input[start:p.pos])
		if token == "" {
			return "", fmt.Errorf("expected operand")
		}
		switch token {
		case "true", "false":
			return token, nil
		}
		if v, ok := p.vars[token]; ok {
			return v, nil
		}
		return token, nil
	}
}

func (p *exprParser) consume(tok string) bool {
	if strings.HasPrefix(p.input[p.pos:], tok) {
		p.pos += len(tok)
		return true
	}
	return false
}

func (p *exprParser) skipSpace() {
	for p.pos < len(p.input) {
		switch p.input[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func isIdentChar(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_'
}

func errorsIs(err error, target error) bool {
	return err != nil && target != nil && (err == target || strings.Contains(err.Error(), target.Error()))
}
