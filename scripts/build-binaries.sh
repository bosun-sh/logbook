#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR="$ROOT_DIR/dist/bin"
TARGETS="darwin-arm64:bun-darwin-arm64 darwin-x64:bun-darwin-x64 linux-arm64:bun-linux-arm64 linux-x64:bun-linux-x64 win32-x64:bun-windows-x64"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for target in $TARGETS; do
  platform=${target%:*}
  bun_target=${target#*:}
  out="$OUT_DIR/$platform"
  mkdir -p "$out"
  ext=""
  case "$platform" in
    win32-*) ext=".exe" ;;
  esac
  bun build --compile --target="$bun_target" --outfile="$out/logbook$ext" "$ROOT_DIR/src/workspace/bin-cli.ts"
  bun build --compile --target="$bun_target" --outfile="$out/logbook-mcp$ext" "$ROOT_DIR/src/workspace/bin-mcp.ts"
done
