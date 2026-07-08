#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

TRANSLATE_HOME="${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"
CLI_WRAPPER="${TRANSLATE_HOME}/bin/claude-translate"

# Config-aware note (adds the english-replies instruction when enabled).
if [ -x "$CLI_WRAPPER" ]; then
  if "$CLI_WRAPPER" hook-session-start 2>/dev/null; then
    exit 0
  fi
fi

cat <<'EOF'
claude-translate is active: Russian/Cyrillic markdown docs are transparently served as cached English translations when Read (token saving). To modify such a doc, edit the original file path from the project, never the cache under ~/.claude/translate-proxy/cache. MCP tools `translate` and `resolve_doc` are available for explicit translation.
EOF
exit 0
