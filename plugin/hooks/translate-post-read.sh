#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

input=$(cat)

TRANSLATE_HOME="${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"

# Cheap gate before booting node: content mode must be enabled in config.
if ! grep -qE '^\s*lazy_read_mode:\s*content' "${TRANSLATE_HOME}/config.yaml" 2>/dev/null; then
  exit 0
fi

# Only .md/.mdx files are candidates (same heuristic as the lazy-read hook).
file_path=$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

if [ -n "$file_path" ]; then
  case "$file_path" in
    *.md|*.mdx) ;;
    *) exit 0 ;;
  esac
fi

CLI_WRAPPER="${TRANSLATE_HOME}/bin/claude-translate"
if [ ! -x "$CLI_WRAPPER" ]; then
  if command -v claude-translate >/dev/null 2>&1; then
    CLI_WRAPPER="claude-translate"
  else
    exit 0
  fi
fi

result=$(printf '%s' "$input" | "$CLI_WRAPPER" hook-post-read 2>/dev/null || true)

if [ -z "$result" ]; then
  exit 0
fi

printf '%s' "$result"
exit 0
