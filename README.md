# claude-translate

Serve your **Cyrillic markdown docs to Claude Code as cached English translations** — and cut the context tokens agents burn re-reading them.

Russian prose tokenizes ~1.8–2× worse than English, and agent workflows read the same docs over and over: project wikis, registries, architecture notes, `CLAUDE.md` on every session start. claude-translate translates a doc **once per version** on a cheap Haiku tier (`claude -p --safe-mode --model claude-haiku-4-5`, billed to your existing Claude subscription — no API key) and serves the cached English on every subsequent `Read`.

Built on the same engine as [cursor-translate](https://github.com/davlet42/cursor-translate) (`@cursor-translate/core`).

## The core value — and its honest economics

Two mechanisms do the actual saving. Both are automatic once installed:

| Mechanism | When it saves |
|---|---|
| **Lazy EN doc cache** — the `PreToolUse` hook redirects every `Read` of a Cyrillic `.md`/`.mdx` to a cached English translation | On every read of every cached doc, in every session and subagent |
| **English `CLAUDE.md`** generated from a Russian source (`claudemd`) | Loaded into **every session** and re-sent with the context on every turn — the highest-leverage doc in a repo |

Translation is an **investment** (one Haiku spend per doc *version*), serving is the **return** (every read). Which means:

- **Pays off:** stable docs that agents read often — knowledge bases, project registries, `CLAUDE.md`.
- **First-time translation is the investment:** a fresh doc repays itself in ~1–3 reads (check the `break-even reads` line in your own `report`).
- **Edits are cheap:** re-translation is **block-incremental** — only the changed callout / paragraph / section is re-billed. And since agents `Read` a doc around every `Edit`, reads ≥ edits in practice, and a single read of a mid-size doc typically covers a one-block update. A doc only stays net-negative when it's bulk-rewritten often and rarely read afterwards (one-off scratch notes).
- **Saves ~nothing:** code-heavy sessions that rarely `Read` Cyrillic markdown — the savings scale directly with how much Cyrillic documentation your agents actually read.

Don't take the pitch's word for it — every cache hit, every translate spend (with real `claude -p` cost receipts) and every missed opportunity is logged. Pull your own numbers any time:

```bash
claude-translate report --days 7
```

```
ROI operational (docs + CLI/MCP prompts — excludes display & warmup):
  doc cache served (lazy read / MCP resolve_doc): ~518011 tokens saved (86 reads)
  incremental doc translate: ~526353 tokens
  net operational ROI: …
ROI investment (one-time doc cache warmup):
  break-even reads (warmup ÷ avg savings/read): ~4 more doc_cache_served events
session opportunity (interactive — not auto-translated):
  user_prompt (RU sent as-is to main model): ~22014 tokens (114 events)
```

How to read it: `doc cache served` is your realized saving; the `doc translate` lines are what the Haiku tier spent to earn it; `session opportunity` is what the extras below *could* additionally capture (and what they'd cost you in trade-offs). Inside Claude Code the same summary is available as the `/translate-report` slash command.

## Installation

```bash
npm install -g claude-translate
claude-translate init --path
source ~/.zshrc   # or open a new terminal
```

Then enable the plugin (hooks + MCP + slash commands) inside Claude Code:

```
/plugin marketplace add davlet42/claude-translate
/plugin install claude-translate@claude-translate
```

For local development instead: `claude --plugin-dir /path/to/claude-translate/plugin`.

Requires the `claude` CLI logged in (Pro/Max subscription) and Node ≥ 20.

## Quick start

```bash
cd ~/Projects/your-repo
claude-translate docs --dry-run   # see what would be cached
claude-translate docs             # warm the EN cache (one-time Haiku spend)
claude-translate claudemd         # English CLAUDE.md from Russian source
claude-translate report --days 7  # savings vs costs
```

## How the core works

### Lazy translate on Read

The plugin's `PreToolUse` hook (matcher `Read`): if the file is `.md`/`.mdx` with Cyrillic and the cache is missing or stale (sha mismatch), it translates via Haiku, caches under `~/.claude/translate-proxy/cache/<project>/…en.md`, and rewrites the tool call's `file_path` to the cache. It also injects a context note telling Claude to edit the **original** file, never the cache. Everything fails open: no CLI, quota exhausted, timeout → the original Russian file is read.

### CLAUDE.md workflow (biggest per-session win)

`CLAUDE.md` is loaded into **every** Claude Code session. Keep the Russian source in `CLAUDE.ru.md` and generate the English `CLAUDE.md`:

```bash
claude-translate claudemd            # first run: seeds CLAUDE.ru.md from a Russian CLAUDE.md
# edit CLAUDE.ru.md later…
claude-translate claudemd            # re-translate (sha marker tracks staleness)
claude-translate claudemd --check    # CI check: exit 1 when stale
```

### Shared cache with cursor-translate

Before spending on a translation, the doc cache checks the **sibling install** — [cursor-translate](https://github.com/davlet42/cursor-translate) keeps the same cache format under `~/.cursor/translate-proxy`. A fresh entry (sha match against the current source) is copied over as `action: sibling_copy` with zero translate cost; only if the sibling is also missing or stale does a real translation run. Works in both directions: docs you translated in Cursor are reused by Claude Code and vice versa.

Config: `cache.share_siblings: true` (default). Override or disable: `CLAUDE_TRANSLATE_SIBLING_HOMES="/path/one:/path/two"` (empty string disables).

### Content mode: replace the Read result instead of the path

```yaml
hooks:
  lazy_read_mode: content   # default: path
```

In `content` mode the `PostToolUse` hook swaps the Read result's `file.content` for the English translation while the model keeps seeing the **original** file path — no cache-path confusion in references. Trade-off: `Edit` old_string matching against the Russian file will not line up with what the model read, so prefer `path` mode for docs you expect the agent to edit.

## CLI commands

| Command | Purpose |
|---|---|
| `init [--path]` | Config, glossary, hook assets, bin wrappers, optional shell PATH |
| `doc <file>` | Translate one file → global cache |
| `docs [path]` | Scan project `*.md` with Cyrillic → cache all |
| `claudemd [--check] [--force]` | Keep an English `CLAUDE.md` generated from `CLAUDE.ru.md` (sha-tracked) |
| `resolve <file>` | Lazy: ensure EN cache, print `readPath` |
| `hook-resolve` | stdin JSON for the PreToolUse Read hook |
| `prompt "<text>"` | RU→EN translate to stdout |
| `agent [claude flags] -- "<prompt>"` | Full RU→EN → `claude -p` → EN→RU |
| `report [--days 7]` | Metrics by source |

## Metrics sources (`~/.claude/translate-proxy/metrics.jsonl`)

| `source` | Trigger |
|---|---|
| `doc_cache_served` | Lazy read / MCP served EN cache (realized savings) |
| `doc_translate_cost` | Doc translation spend (`reason: claudemd` for CLAUDE.md syncs) |
| `prompt_translated` / `response_back_translated` | CLI `agent` & `prompt`, MCP `translate` |
| `display_hook` | Display-translation outcome per reply (see extras) |
| `user_prompt` / `agent_response` | Opportunity audit from hooks (what auto-translate *would* save) |

## Extras (opt-in, off by default, experimental)

Everything below is flipped in **your local** `~/.claude/translate-proxy/config.yaml` — the file is created on your machine by `claude-translate init` from the packaged template and is yours to edit; nothing here requires forking the repo.

The platform reality that shapes these features: Claude Code's `UserPromptSubmit` hook cannot rewrite your prompt (block + add context only), and no hook can transform the assistant's **transcript** text. So prompt- and reply-side savings can only be attacked from angles — each with a real trade-off. The doc cache above has no such trade-off; these do.

### Russian on screen, English in the transcript (display translation)

> **Read this first — it is not real-time.** `MessageDisplay` is a post-render hook: every reply appears in **English first** and is replaced with Russian only when the translation lands. The translate tier runs on your own Claude subscription (`claude -p`, Haiku), so it queues behind everything else your account is doing: roughly 10–60 s per reply on an idle account, and **minutes** while parallel agent sessions hammer the same subscription. Treat this mode as *eventual Russian* in exchange for output-token savings. If you want replies in Russian **immediately**, leave both flags off (the default): the model simply answers in Russian — at the cost of ~1.5–2× output tokens on replies and a slightly heavier transcript, while skipping the Haiku translate spend entirely.

```yaml
response:
  display_back_translate: true   # MessageDisplay hook: RU on screen (eventually), EN in transcript
  english_replies: true          # ask the model to reply in English (~2× fewer output tokens)
```

With both on, the model is instructed (via SessionStart) to answer in English, and the `MessageDisplay` hook translates each displayed reply to Russian through Haiku. The transcript keeps the English text, so later turns and compactions stay cheap.

Mechanics (v0.3.5): Claude Code dispatches the chunk events of one message **concurrently**, so on the final chunk the hook resolves the full message text from the session transcript (`transcript_path`) instead of reassembling buffered deltas; mixed-language replies are segmented per paragraph (Russian paragraphs pass through verbatim, only English runs are translated); the hook timeout is 600 s to survive subscription throttling. Every outcome is logged to `metrics.jsonl` as `source: "display_hook"` (`displayed`, `unchanged`, `already_russian`, `below_min_chars`, `above_max_chars`, `quota_latched`, `unrecognized_payload`, `hook_error`) — `grep display_hook` answers "why was this reply shown in English". Replies shorter than `display_min_chars` (80) or longer than `display_max_chars` (12000) are shown as-is. Requires Claude Code ≥ 2.1.152.

### Full agent wrapper (headless) — the only place prompts get auto-translated

```bash
claude-translate agent --model sonnet -- "сделай ревью PR и опиши риски"
```

```
User RU → Haiku (translate in)
       → claude -p (your model; hooks/doc-cache still active)
       → Haiku (translate out, optional — response.back_translate)
```

Interactive sessions can't get this (the platform limit above); the wrapper is for scripts, cron jobs and CI where the RU→EN→agent→RU loop runs outside the model.

### MCP tools: `translate` / `resolve_doc` — for hosts without hooks

Cloud Agents, CI runners and other MCP clients have no `PreToolUse` hook — there, `resolve_doc` is the explicit way to get the EN cache for a Cyrillic doc (`include_body: true` to inline the content). `translate` is an on-demand RU↔EN capability on the cheap tier, glossary-aware and metered. In interactive Claude Code with the plugin installed these mostly stay idle — the hooks already did the job — and that's by design.

### Opportunity audits

`UserPromptSubmit` / `Stop` / `SubagentStop` hooks log what auto-translation *would* have saved (`user_prompt`, `agent_response`, `subagent_summary` sources) — that's the `session opportunity` block in `report`. Audit only, no behavior change.

## Two-tier model strategy

| Tier | Model | Used for | ~API rate (in/out per 1M) |
|---|---|---|---|
| **Main agent** | Fable / Opus / Sonnet (your setting) | Code, reasoning, tools | $5–25+ / $25–75+ |
| **Translate tier** | `claude-haiku-4-5` (default) | RU↔EN prose only | ~$1 / $5 |

Translate hops run as:

```bash
claude -p --safe-mode --no-session-persistence --tools "" \
  --model claude-haiku-4-5 --system-prompt "<translator prompt>"
```

`--safe-mode` keeps subscription (OAuth) auth working while disabling hooks, plugins, MCP, CLAUDE.md discovery — a minimal, recursion-safe, cheap call. (`--bare` is *not* used: it drops OAuth.)

Override: `CLAUDE_TRANSLATE_MODEL=claude-haiku-4-5` or `translator.model` in `~/.claude/translate-proxy/config.yaml`. CI/headless without a subscription: `CLAUDE_TRANSLATE_PROVIDER=openai` + `OPENAI_API_KEY`.

## Plugin contents

- **Hooks:** `PreToolUse` lazy read (600s timeout), `PostToolUse` content mode, `MessageDisplay` display translation (600s timeout, off by default), `UserPromptSubmit`/`Stop` opportunity audits, `SessionStart` context note (adds the english-replies instruction when enabled). All guarded by `CLAUDE_TRANSLATE_HOP=1` against recursion; disabled features exit before booting node.
- **MCP:** `translate` + `resolve_doc` (reuses `@cursor-translate/mcp`; wrapper installed by `init` exports the Claude home).
- **Slash commands:** `/translate-docs` (warm cache), `/translate-report` (metrics summary).

## Config

`~/.claude/translate-proxy/config.yaml` — your local file, created by `init` from `templates/config.yaml`:

```yaml
translator:
  provider: claude-cli
  model: claude-haiku-4-5
```

Custom translation rules: `.claude/claude-translate.md`, a `## claude-translate` section in `CLAUDE.md`/`AGENTS.md`, or `~/.claude/translate-proxy/claude-translate-rules.md`. Project glossary: `.claude/claude-translate-glossary.yaml`.

## Related docs

- **[Runtime guide](./docs/runtime-guide.md)** — hook contracts (exact stdin/stdout JSON), config and env reference, metrics, troubleshooting, fail-open guarantees
- **[Cloud and remote sessions](./docs/cloud-and-remote.md)** — what works on the web/CI, committed EN caches, `claudemd --check` gate
- **[Publishing](./docs/publishing.md)** — npm release flow, CI, lockfile notes
- **[Changelog](./CHANGELOG.md)**

## License

MIT
