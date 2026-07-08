# Global claude-translate rules (optional)

Copy to `~/.claude/translate-proxy/claude-translate-rules.md` and edit.

Or add a `## claude-translate` section to project `CLAUDE.md` / `AGENTS.md`,
or create `.claude/claude-translate.md` in the repo.

Example project-specific rules:

- Keep product names in Russian when they are customer-facing brands.
- Translate "бэклог" as "backlog", never "reserve list".
- Never translate task IDs or ROADMAP section anchors.
- Preserve mermaid node labels that are already in English.
