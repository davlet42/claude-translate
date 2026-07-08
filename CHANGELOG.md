# Changelog

## 0.2.1 (2026-07-08)

- **Fix display translation with the real MessageDisplay event shape.** The hooks docs describe a `message_text` field, but the actual event is a display stream: `{ message_id, turn_id, index, final, delta }`. The 0.2.0 hook read `message_text`, got nothing, and silently showed the original English reply. `hook-display` now buffers non-final deltas per `message_id` (`display-buffer.jsonl`) and translates the assembled text on the final chunk; the documented `message_text` shape is still accepted.
- MessageDisplay hook timeout raised 30s → 60s for long replies.

## 0.2.0 (2026-07-08)

Roadmap features — all opt-in via `~/.claude/translate-proxy/config.yaml`:

- **Display translation** (`response.display_back_translate`): MessageDisplay hook shows assistant replies in Russian while the transcript stays English (cheaper later turns and compactions). Thresholds: `display_min_chars` / `display_max_chars`. Requires Claude Code ≥ 2.1.152.
- **English replies** (`response.english_replies`): SessionStart instruction asking the model to reply in English (~2× fewer output tokens on Cyrillic); only applied when display translation is also enabled.
- **Content mode** (`hooks.lazy_read_mode: content`): PostToolUse hook replaces the Read result's `file.content` with the English translation while the model keeps seeing the original file path. Note: the Read `tool_response` is a structured object and `updatedToolOutput` must mirror its shape.
- New CLI commands: `hook-display`, `hook-post-read`, `hook-session-start`; `init` installs the new hook scripts.
- Docs: comprehensive [runtime guide](./docs/runtime-guide.md) (hook contracts, config/env reference, troubleshooting).
- Requires `@cursor-translate/core` ≥ 0.2.1 for nested config keys to be read reliably (core ≤ 0.2.0 had a YAML-section parsing bug that silently ignored nested keys such as `translator.model` and `cache.share_siblings`).

## 0.1.2

- npm publish workflow (GitHub Actions on `v*` tags), publishing docs, bin path fix, lockfile resolution from the registry.

## 0.1.0

- Initial release: lazy EN doc cache via PreToolUse Read hook, `claudemd` (English CLAUDE.md from `CLAUDE.ru.md` with sha tracking), `agent`/`prompt` CLI wrapper around `claude -p`, sibling cache sharing with cursor-translate, metrics + report, MCP `translate`/`resolve_doc` reuse, Claude Code plugin + marketplace.
