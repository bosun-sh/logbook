package logbook

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

func newUUID() string {
	var b [16]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	buf := make([]byte, 36)
	hex.Encode(buf[0:8], b[0:4])
	buf[8] = '-'
	hex.Encode(buf[9:13], b[4:6])
	buf[13] = '-'
	hex.Encode(buf[14:18], b[6:8])
	buf[18] = '-'
	hex.Encode(buf[19:23], b[8:10])
	buf[23] = '-'
	hex.Encode(buf[24:36], b[10:16])
	return string(buf)
}

func readFileOrEmpty(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return string(b), nil
}

func splitLines(content string) []string {
	raw := strings.Split(content, "\n")
	out := make([]string, 0, len(raw))
	for _, line := range raw {
		if strings.TrimSpace(line) != "" {
			out = append(out, line)
		}
	}
	return out
}

func isEnoent(err error) bool {
	return errors.Is(err, os.ErrNotExist)
}

func joinPath(dir, name string) string {
	return filepath.Join(dir, name)
}

func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func nearestFib(scaled float64) int {
	fibs := []int{1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144}
	best := fibs[0]
	minDist := math.Abs(float64(best) - scaled)
	for _, fib := range fibs {
		dist := math.Abs(float64(fib) - scaled)
		if dist == 0 {
			return fib
		}
		if dist < minDist || (dist == minDist && fib > best) {
			best = fib
			minDist = dist
		}
	}
	return best
}

func formatContextValue(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprint(v)
	}
}
