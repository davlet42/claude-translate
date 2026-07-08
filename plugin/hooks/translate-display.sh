#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

input=$(cat)

TRANSLATE_HOME="${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"

# Cheap gate before booting node: feature must be enabled in config.
if ! grep -qE '^\s*display_back_translate:\s*true' "${TRANSLATE_HOME}/config.yaml" 2>/dev/null; then
  exit 0
fi

CLI_WRAPPER="${TRANSLATE_HOME}/bin/claude-translate"
if [ ! -x "$CLI_WRAPPER" ]; then
  if command -v claude-translate >/dev/null 2>&1; then
    CLI_WRAPPER="claude-translate"
  else
    exit 0
  fi
fi

result=$(printf '%s' "$input" | "$CLI_WRAPPER" hook-display 2>/dev/null || true)

if [ -z "$result" ]; then
  exit 0
fi

printf '%s' "$result"
exit 0
