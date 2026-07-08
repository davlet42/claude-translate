#!/usr/bin/env bash
set -euo pipefail

# Recursion guard: claude-translate hops spawn `claude -p` with this env set
# (and --safe-mode already skips hooks); exit fast either way.
if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

input=$(cat)

# Cheap pre-filter without jq: only .md/.mdx files are candidates. If the
# extraction heuristic fails, fall through to the CLI which parses properly.
file_path=$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)

if [ -n "$file_path" ]; then
  case "$file_path" in
    *.md|*.mdx) ;;
    *) exit 0 ;;
  esac
fi

TRANSLATE_HOME="${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"
CLI_WRAPPER="${TRANSLATE_HOME}/bin/claude-translate"

if [ ! -x "$CLI_WRAPPER" ]; then
  if command -v claude-translate >/dev/null 2>&1; then
    CLI_WRAPPER="claude-translate"
  else
    # Fail open: no CLI installed, let the Read proceed untouched.
    exit 0
  fi
fi

result=$(printf '%s' "$input" | "$CLI_WRAPPER" hook-resolve 2>/dev/null || true)

if [ -z "$result" ]; then
  exit 0
fi

printf '%s' "$result"
exit 0
