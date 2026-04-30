package main

import (
	"logbook/internal/logbook"
	"os"
	"strings"
)

func main() {
	os.Exit(logbook.RunCLI(os.Args[1:], envMap()))
}

func envMap() map[string]string {
	m := map[string]string{}
	for _, kv := range os.Environ() {
		if eq := strings.IndexByte(kv, '='); eq >= 0 {
			m[kv[:eq]] = kv[eq+1:]
		}
	}
	return m
}
