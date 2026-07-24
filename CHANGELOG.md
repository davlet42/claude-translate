# Changelog

## 0.3.10 (2026-07-24)

- Same as 0.3.9 (core ≥ 0.2.13 lazy-read hang fix). Re-release: npm reserved `0.3.9` without a public tarball (`cannot publish over previously published versions` / not in registry).

## 0.3.9 (2026-07-24)

- **Pull `@cursor-translate/core` ≥ 0.2.13** — fixes multi-minute Read hangs on mid-size Cyrillic docs when `cache.incremental: block` (lazy_read chunk limit now counts incremental Cyrillic units; hook timeout 15s fail-open).
- Dependencies: `@cursor-translate/core` ^0.2.13; optional `@cursor-translate/mcp` ^0.2.13.

## 0.3.8 (2026-07-24)

- **Block-level incremental cache** via `@cursor-translate/core` ≥ 0.2.12. Default `cache.incremental: block` — callouts / paragraphs inside `##`/`###`, so editing one revision note in a long roadmap preamble no longer re-translates the whole blob. Modes: `block` · `paragraph` · `section` · `off`.
- Dependencies: `@cursor-translate/core` ^0.2.12; optional `@cursor-translate/mcp` ^0.2.12.
- CI: `actions/checkout@v5` + `actions/setup-node@v5` (Node 24 runtime; clears Node 20 deprecation warnings).

## 0.3.7 (2026-07-12)

- **Orphan cache GC** (via `@cursor-translate/core` ≥ 0.2.11): caches of deleted/renamed docs used to live forever (invalidation is sha-based only). New `claude-translate cache-gc [--dry-run] [--days N]` command plus a throttled auto-sweep on the translate path (at most once a day): a cache whose source has been missing for over `cache.gc_orphan_days` (default 30, `0` disables) is removed together with its `.en.sections.json` sidecar. The grace period protects git branch switches; runs are logged as `source: "cache_gc"`.
- **Config:** the dead `cache.ttl_days` template key (parsed nowhere) replaced by `cache.gc_orphan_days`.

## 0.3.6 (2026-07-12)

- **README repositioned around the measured value.** The core (and the focus) is the Cyrillic doc cache + English `CLAUDE.md` — with the honest economics (translation is an investment per doc version repaid in a few reads; edits are cheap thanks to section-incremental re-translation; savings scale with how much Cyrillic markdown agents read) and `claude-translate report` promoted so users pull their own numbers. Display translation, the headless `agent` wrapper, MCP tools and audits moved under "Extras (opt-in, off by default, experimental)", with an explicit note that all of them are toggled in the user's local `~/.claude/translate-proxy/config.yaml`.
- **Release tooling:** `scripts/sync-plugin-version.mjs` keeps `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` on the `package.json` version — synced automatically on `npm version`, verified on `prepack` (publish fails on drift). Fixes the v0.3.5 situation where npm/GitHub shipped the release while the plugin marketplace still offered 0.3.4.

## 0.3.5 (2026-07-12)

Display translation rebuilt around how Claude Code actually dispatches `MessageDisplay` (diagnosed live 2026-07-11/12 on CC 2.1.204):

- **Transcript-first final.** Chunk events of one message are dispatched *concurrently*, so the old "buffer deltas, assemble on final" design raced itself — the final drained the buffer before the middle chunks landed, and long replies got a fragment translated or nothing. On the final chunk the hook now resolves the full message text from the session transcript (`transcript_path`; newest assistant entry whose text ends with the final delta), with one 400 ms retry for the sub-second transcript write lag; buffered deltas remain only as a fallback.
- **Per-paragraph language gate.** Mixed RU/EN replies used to ride one chunk over core's 0.15 Cyrillic gate and stay untranslated. Replies are now segmented per paragraph: Russian paragraphs pass through verbatim (no translate call at all), consecutive English runs batch into ≤1500-char chunks.
- **No more silent `{}` exits.** Every hook outcome logs a `source: "display_hook"` metric (`displayed`, `unchanged`, `already_russian`, `below_min_chars`, `above_max_chars`, `quota_latched`, `unrecognized_payload`, `hook_error` — the last one also catches exceptions that were previously swallowed by fail-open). `grep display_hook metrics.jsonl` now answers "why was this reply shown in English".
- **MessageDisplay hook timeout 120 s → 600 s.** Subscription-tier translation queues behind everything else the account is doing; measured worst case for a 3.1k-char reply on a busy account: 5 min 4 s end-to-end (would have been killed at 120 s). Note Claude Code's *default* MessageDisplay timeout is only 10 s — the explicit value is mandatory.
- **README honesty pass.** Display mode is documented as *eventual Russian* (English renders first, Russian replaces it when the translation lands; seconds when idle, minutes under load) — not real-time. For immediate Russian, keep `english_replies`/`display_back_translate` off (the default) and let the model answer in Russian directly.

## 0.3.4 (2026-07-08)

- **Full economy report** (via `@cursor-translate/core` ≥ 0.2.7): `ROI full economy` section includes display transcript EN savings; `user_prompt` labeled as interactive-session opportunity (terminal `claude` with plugin, not `claude-translate agent`).

## 0.3.3 (2026-07-08)

Fixes the "replies suddenly show in English again" failure chain (requires `@cursor-translate/core` ≥ 0.2.6):

- **Quota latch now expires.** When a translate hop hits the subscription usage limit, core writes a quota latch that used to disable prompt/display translation *permanently* (it only cleared after a successful doc translation). The latch now auto-expires after 30 minutes (`CLAUDE_TRANSLATE_QUOTA_TTL_MIN` to override).
- **Quota is no longer silent.** While the latch is active the display hook emits a `systemMessage` ("translate tier hit its usage limit…") instead of silently showing English.
- **Parallel display translation.** Long replies are split by paragraphs and translated concurrently — wall-clock is the slowest chunk, not the sum (measured: 2.5k chars 116s → 54s on a throttled account; ~10–20s normally). MessageDisplay hook timeout raised 60s → 120s as headroom.



## 0.3.2 (2026-07-08)

- **Fix section cache flat file** (via `@cursor-translate/core` ≥ 0.2.5): `claude-translate doc` no longer leaves only `*.en.sections.json` without the flat `*.en.md`; read-path self-heal rebuilds missing flat caches from sidecars.

## 0.3.1 (2026-07-08)

- **Lazy read deferral hints**: `systemMessage` on skipped large-doc reads with estimated warmup cost and per-read savings (requires `@cursor-translate/core` ≥ 0.2.4).
- **Report wording**: session hooks, not IDE.
- Config/runtime docs for `lazy_read_*` and `cache.incremental: section`.

## 0.3.0 (2026-07-08)

- **Real cost tracking**: translate hops now run `claude -p --output-format json` and record the actual `total_cost_usd` receipt as `translate_cost_usd` in `metrics.jsonl` (doc cache, prompt/back-translate, display translation, `claudemd`). `report` shows `actual translate spend: $X.XXXX (N calls with claude receipts)` alongside the estimates. Requires `@cursor-translate/core` ≥ 0.2.3; with older cores everything still works on estimates.
- **Subagent audit**: new `SubagentStop` hook logs `subagent_summary` opportunity metrics (parity with cursor-translate).
- **Cloud playbook**: [docs/cloud-and-remote.md](./docs/cloud-and-remote.md) — committed EN `CLAUDE.md`/docs patterns, `claudemd --check` CI gate, MCP for cloud agents, verified vs unverified split.
- **Listing polish**: plugin logo and rewritten marketplace description.
- **Roadmap closed** (decisions, so nobody waits for these): *streaming-aware display translation* — rejected; the 0.2.1 delta-buffering already handles streamed messages correctly by translating once on the final chunk, and per-chunk translation of Russian word order would degrade quality. *Formal output-style preset* — rejected; the SessionStart english-replies instruction does the same job and the plugin output-style format is undocumented.

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
