# Runtime guide

How claude-translate works at runtime: hook contracts, config reference, environment variables, metrics, and troubleshooting. Verified against Claude Code 2.1.198.

## Summary matrix

| Mechanism | Surface | Default | Config key |
|---|---|---|---|
| Lazy EN doc cache (path rewrite) | `PreToolUse` hook on `Read` | on | `hooks.lazy_read_mode: path` |
| Lazy EN doc cache (content replace) | `PostToolUse` hook on `Read` | off | `hooks.lazy_read_mode: content` |
| RU display of EN replies | `MessageDisplay` hook | off | `response.display_back_translate` |
| English replies instruction | `SessionStart` context | off | `response.english_replies` |
| English `CLAUDE.md` from `CLAUDE.ru.md` | `claudemd` CLI command | manual | — |
| Prompt/reply translation loop | `claude-translate agent` CLI | manual | `response.prompt_translate` / `back_translate` |
| Opportunity audit metrics | `UserPromptSubmit` / `Stop` hooks | on | `hooks.audit_enabled` |
| Sibling cache reuse (cursor-translate ↔ claude-translate) | doc cache internals | on | `cache.share_siblings` |
| MCP `translate` / `resolve_doc` | MCP server | on with plugin | — |

**Platform limits (why some things are manual):** `UserPromptSubmit` cannot rewrite your prompt (block + additionalContext only), and no hook can transform the assistant's *transcript* text. Everything else above is fully automatic.

## The translate hop

Every translation runs a minimal, recursion-safe, subscription-billed Haiku call:

```bash
claude -p --safe-mode --no-session-persistence --tools "" \
  --output-format text --model claude-haiku-4-5 \
  --system-prompt "<translator prompt + glossary>"      # text arrives on stdin
```

- `--safe-mode` disables hooks, plugins, MCP, skills, and CLAUDE.md discovery **while keeping OAuth subscription auth**. Do not replace it with `--bare`: `--bare` reads auth only from `ANTHROPIC_API_KEY` and will fail on a subscription login.
- `--system-prompt` replaces the (large) default system prompt with a ~100-token translator prompt.
- The spawned process gets `CLAUDE_TRANSLATE_HOP=1`; every hook script exits immediately when it sees that variable — second layer of recursion protection.
- Quota errors (`usage limit`, `limit reached`, `429`, …) trigger the fallback model once (`translator.doc_fallback_model`), then fail open: the original Russian text is used and prompt/response translation is paused via a quota-state file until a translation succeeds again.

## Hook contracts

All hook scripts live in `plugin/hooks/` (referenced via `${CLAUDE_PLUGIN_ROOT}`) and are copied by `claude-translate init` to `~/.claude/translate-proxy/hooks/` for plugin-less setups. **They must keep their executable bit** — a non-executable hook script is silently skipped by Claude Code.

Shared behavior: exit fast on `CLAUDE_TRANSLATE_HOP=1`; locate the CLI via `~/.claude/translate-proxy/bin/claude-translate`, falling back to `PATH`; fail open (empty output) on any error.

### PreToolUse → `translate-lazy-read.sh` → `claude-translate hook-resolve`

Default lazy-read mechanism (`lazy_read_mode: path`).

stdin (from Claude Code):

```json
{ "hook_event_name": "PreToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "/abs/path/DOC.md", "offset": 1, "limit": 100 },
  "cwd": "/project", "session_id": "…" }
```

stdout on a Cyrillic `.md`/`.mdx` (cache hit, sibling copy, or translate-on-miss):

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
    "updatedInput": { "file_path": "~/.claude/translate-proxy/cache/<slug>/DOC.en.md", "offset": 1, "limit": 100 },
    "additionalContext": "claude-translate: serving the cached English translation of … edit the original file …" },
  "suppressOutput": true }
```

`{}` in every other case (non-md, no Cyrillic, disabled, fail-open). On quota exhaustion a `systemMessage` warns the user. Timeout in `hooks.json`: 600s (first-time translation of a large doc).

### PostToolUse → `translate-post-read.sh` → `claude-translate hook-post-read`

Active only when `hooks.lazy_read_mode: content`. The bash gate greps the config before booting node, so in `path` mode the cost is one `grep`.

**Reality check (differs from the hooks docs):** the field is `tool_response` (not `tool_output`), and for `Read` it is a structured object, not a string:

```json
{ "hook_event_name": "PostToolUse", "tool_name": "Read",
  "tool_input": { "file_path": "/abs/path/DOC.md" },
  "tool_response": { "type": "text",
    "file": { "filePath": "/abs/path/DOC.md", "content": "…raw text, no line numbers…",
              "numLines": 4, "startLine": 1, "totalLines": 4 } },
  "cwd": "/project" }
```

`updatedToolOutput` **must mirror that exact shape** — Claude Code validates it and rejects plain strings ("does not match Read's output shape"). The hook clones the response and swaps `file.content` for the English body:

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse",
    "updatedToolOutput": { "type": "text",
      "file": { "filePath": "/abs/path/DOC.md", "content": "…English…", "numLines": 3, "startLine": 1, "totalLines": 3 } },
    "additionalContext": "claude-translate: this Read result is the cached English translation of … edit the original file …" } }
```

The model keeps seeing the **original** path. Trade-off: `Edit` old_string matching against the Russian file will not line up with what the model read — prefer `path` mode for docs the agent should edit.

### MessageDisplay → `translate-display.sh` → `claude-translate hook-display`

Active only when `response.display_back_translate: true` (bash grep gate). Requires Claude Code ≥ 2.1.152.

**Reality check (differs from the hooks docs):** there is no `message_text` field. The event is a display **stream** — one hook invocation per chunk:

```json
{ "hook_event_name": "MessageDisplay", "session_id": "…", "cwd": "…",
  "turn_id": "…", "message_id": "…", "index": 0, "final": true,
  "delta": "…text chunk…" }
```

In headless (`--print`) runs the whole message arrives as a single `final: true` delta; interactive sessions may fire many chunks per message. The hook buffers non-final deltas in `~/.claude/translate-proxy/display-buffer.jsonl` keyed by `message_id`, and on the final delta assembles the full text, translates it, and returns:

```json
{ "hookSpecificOutput": { "hookEventName": "MessageDisplay", "displayContent": "…русский перевод…" } }
```

Display-only by platform design: the transcript, later turns, and compaction all keep the English text. While a reply streams you may briefly see English; the Russian text replaces it once the final chunk is translated. Replies already in Russian (cyrillic ratio ≥ 0.15), shorter than `display_min_chars`, or longer than `display_max_chars` pass through untouched. Cost is logged as `response_back_translated`. Hook timeout 60s, fail-open. The documented `message_text` shape is still accepted for forward compatibility.

### SessionStart → `translate-session-start.sh` → `claude-translate hook-session-start`

Prints a context note (stdout becomes session context): docs are served as English translations; edit originals, not the cache. When `response.english_replies` **and** `response.display_back_translate` are both true, it appends the instruction to reply in English (the display layer shows Russian). The instruction is deliberately suppressed if display translation is off — otherwise you would be stuck reading English.

### UserPromptSubmit / Stop / SubagentStop → audit scripts → `log-metrics.mjs`

Metrics only, never block. `user_prompt` reads the `prompt` field; `agent_response` extracts the last assistant message from `transcript_path` (JSONL); `subagent_summary` (SubagentStop) does the same for subagent transcripts. All log "what auto-translation would have saved" to `metrics.jsonl`.

## Config reference (`~/.claude/translate-proxy/config.yaml`)

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Master switch; off = everything passes through |
| `min_cyrillic_ratio` | `0.15` | Minimum Cyrillic share for a text to qualify |
| `min_chars_to_translate` | `120` | Below this, translation never pays off |
| `translator.provider` | `claude-cli` | `claude-cli` \| `openai` \| `cursor-cli` |
| `translator.model` | `claude-haiku-4-5` | Translate-tier model |
| `translator.doc_fallback_model` | `claude-sonnet-5` | Retry model on quota errors |
| `response.prompt_translate` | `true` | RU→EN hop in `claude-translate agent` / `prompt` |
| `response.back_translate` | `true` | EN→RU hop for `agent` output and the display hook |
| `response.display_back_translate` | `false` | MessageDisplay RU display of EN replies |
| `response.display_min_chars` | `80` | Skip shorter replies |
| `response.display_max_chars` | `12000` | Skip longer replies (latency guard) |
| `response.english_replies` | `false` | SessionStart instruction to reply in English |
| `cache.share_siblings` | `true` | Reuse fresh cursor-translate cache entries |
| `hooks.lazy_read_mode` | `path` | `path` (PreToolUse rewrite) \| `content` (PostToolUse replace) |

> Requires `@cursor-translate/core` ≥ 0.2.1 for nested keys to be read reliably: earlier cores had a YAML-section parsing bug that silently fell back to defaults for every nested key.

## Environment variables

| Variable | Meaning |
|---|---|
| `CLAUDE_TRANSLATE_HOME` | Home dir override (default `~/.claude/translate-proxy`); mapped onto core's `CURSOR_TRANSLATE_HOME` |
| `CLAUDE_TRANSLATE_MODEL` / `CLAUDE_TRANSLATE_DOC_FALLBACK_MODEL` | Model overrides for the claude-cli provider |
| `CLAUDE_TRANSLATE_PROVIDER` | Provider override (e.g. `openai` in CI) |
| `CLAUDE_TRANSLATE_BIN` | Path to the `claude` binary for translate hops |
| `CLAUDE_TRANSLATE_SIBLING_HOMES` | Colon-separated sibling homes for cache sharing; empty string disables |
| `CLAUDE_TRANSLATE_METRICS_PATH` | Metrics file override |
| `CLAUDE_TRANSLATE_VERBOSE=1` | Hop diagnostics on stderr for `agent` / `prompt` |
| `CLAUDE_TRANSLATE_HOP=1` | Set automatically inside translate hops; hooks exit when present |
| `OPENAI_API_KEY` | Required only with `provider: openai` |

## Metrics and the report

`~/.claude/translate-proxy/metrics.jsonl`, one JSON per event. `claude-translate report --days 7` aggregates:

| `source` | Meaning | Counted as |
|---|---|---|
| `doc_cache_served` | EN cache served on Read (`action`: `cache_hit` / `sibling_copy` / `translated` / `cache_refreshed`) | realized savings |
| `doc_translate_cost` | Haiku spend for doc translation (`reason`: `warmup_translate` / `lazy_translate` / `claudemd`) | translate cost |
| `prompt_translated` | RU→EN prompt hops (CLI + MCP) | realized savings + cost |
| `response_back_translated` | EN→RU hops: `agent` output **and** display translations | translate cost |
| `user_prompt` / `agent_response` | Hook audits — what auto-translation would save | opportunity |

USD estimates use Haiku translate pricing for spend and a blended main-agent rate for savings. `sibling_copy` events are savings with zero cost.

**Actual receipts:** with `@cursor-translate/core` ≥ 0.2.3 every claude-cli translate hop runs `claude -p --output-format json` and stores the reported `total_cost_usd` as `translate_cost_usd` on the metrics entry. The report sums these into `actual translate spend: $X.XXXX (N calls with claude receipts)` — real money, not estimates. Entries without the field (older core, openai/cursor-cli providers) stay estimate-only.

## Troubleshooting

1. **Hooks don't seem to fire** — run `claude -p "…" --plugin-dir /path/to/claude-translate/plugin --debug-file /tmp/hooks.log` and grep the log for `hook`. Look for `Registered N hooks`, `Hook PreToolUse:Read … success`, `replaced tool output`.
2. **Hook registered but nothing happens** — check the executable bit: `ls -l plugin/hooks/*.sh` must show `rwxr-xr-x`. A `Write`-created or re-created script loses it.
3. **`updatedToolOutput … does not match Read's output shape`** — the replacement must be the structured `{type, file:{…}}` object, not a string (see PostToolUse above).
4. **Everything silently uses defaults** — `~/.claude/translate-proxy/bin/claude-translate` may be missing (run `init`), or core < 0.2.1 is ignoring nested config keys.
5. **Translate hops fail with auth errors** — you are on a subscription and something replaced `--safe-mode` with `--bare`, or `claude` is not logged in (`claude auth`).
6. **Verify savings end-to-end** — `claude-translate resolve <ru-doc.md> --json` (expect `cache_hit`/`sibling_copy`/`translated`), then `claude-translate report --days 1`.
7. **Double translations after installing the plugin** — if you previously merged hooks into `~/.claude/settings.json` manually, remove them; the plugin registers its own.

## Fail-open guarantees

Every automatic path degrades to "serve the original Russian text / show the original reply": missing CLI, quota exhaustion, timeouts, malformed hook input, unknown tool-response shapes, and parse errors all return `{}` from hooks. The only user-visible signal is an optional `systemMessage` on quota exhaustion.
