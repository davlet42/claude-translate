---
description: Warm the English doc cache for this project's Cyrillic markdown files
allowed-tools: Bash(claude-translate *), Bash(*/translate-proxy/bin/claude-translate *)
---

Warm the claude-translate English doc cache for the current project.

1. Run `claude-translate docs --dry-run` first (fall back to `~/.claude/translate-proxy/bin/claude-translate` if not on PATH) and show the user which files would be translated.
2. If the list looks right, run `claude-translate docs` to translate and cache them. This spends cheap Haiku tokens once; afterwards every Read of those files is served in English from cache.
3. Report what was cached and the estimated per-read savings. Also suggest `claude-translate claudemd` if CLAUDE.md itself is Russian.

$ARGUMENTS
