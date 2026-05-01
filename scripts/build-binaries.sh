#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR="$ROOT_DIR/dist/bin"
TARGETS="darwin/arm64 darwin/amd64 linux/arm64 linux/amd64 windows/amd64"
: "${GOCACHE:=/tmp/go-build}"
: "${GOMODCACHE:=/tmp/go-mod}"
: "${VERSION:=dev}"
LDFLAGS="-s -w -X logbook/internal/logbook.Version=$VERSION"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for target in $TARGETS; do
  os=${target%/*}
  arch=${target#*/}
  platform="$os-$arch"
  out="$OUT_DIR/$platform"
  mkdir -p "$out"
  ext=""
  case "$os" in
    windows) ext=".exe" ;;
  esac
  env GOCACHE="$GOCACHE" GOMODCACHE="$GOMODCACHE" GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath -ldflags "$LDFLAGS" -o "$out/logbook$ext" "$ROOT_DIR/cmd/logbook"
  env GOCACHE="$GOCACHE" GOMODCACHE="$GOMODCACHE" GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath -ldflags "$LDFLAGS" -o "$out/logbook-mcp$ext" "$ROOT_DIR/cmd/logbook-mcp"
done
