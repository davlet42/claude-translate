#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

input=$(cat)

TRANSLATE_HOME="${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"
LOG_SCRIPT="${TRANSLATE_HOME}/hooks/log-metrics.mjs"
if [ ! -f "$LOG_SCRIPT" ]; then
  LOG_SCRIPT="$(dirname "$0")/log-metrics.mjs"
fi

if [ -f "$LOG_SCRIPT" ]; then
  printf '%s' "$input" | SOURCE=user_prompt node "$LOG_SCRIPT" 2>/dev/null || true
fi

exit 0
