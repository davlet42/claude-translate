#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_TRANSLATE_HOP:-}" = "1" ]; then
  exit 0
fi

cat <<'EOF'
claude-translate is active: Russian/Cyrillic markdown docs are transparently served as cached English translations when Read (token saving). To modify such a doc, edit the original file path from the project, never the cache under ~/.claude/translate-proxy/cache. MCP tools `translate` and `resolve_doc` are available for explicit translation.
EOF
exit 0
