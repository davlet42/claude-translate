# claude-translate

Open-source layer to **save tokens on Cyrillic text** when using **Claude Code**.

Russian prose tokenizes ~1.8–2× worse than English. claude-translate routes all RU↔EN translation through a **cheap Haiku tier** (`claude -p --safe-mode --model claude-haiku-4-5`, billed to your existing Claude subscription — no API key), so your **main model only ever sees English** docs and prompts.

Built on the same engine as [cursor-translate](https://github.com/davlet42/cursor-translate) (`@cursor-translate/core`).

## What saves tokens, where

| Mechanism | Interactive Claude Code | `claude-translate agent` (headless) |
|---|---|---|
| Lazy EN doc cache on `Read` of Cyrillic `.md`/`.mdx` | ✅ PreToolUse hook rewrites `file_path` | ✅ same |
| English `CLAUDE.md` from Russian source (`claudemd`) | ✅ saves on **every session start** | ✅ |
| Auto-translate your prompt | ❌ audit only (platform limit) | ✅ RU→EN before the main model |
| Auto back-translate the reply | ❌ audit only (roadmap: MessageDisplay) | ✅ EN→RU after the main model |
| MCP `translate` / `resolve_doc` | ✅ explicit tools | ✅ |

**Honest positioning:** Claude Code's `UserPromptSubmit` hook cannot rewrite your prompt (block + add context only), and no hook can transform the assistant's transcript text. So in the interactive UI the automatic win is **docs + CLAUDE.md**; the full RU→EN→agent→RU loop needs the CLI wrapper. `PreToolUse` **can** rewrite tool input (`hookSpecificOutput.updatedInput`) — that is how lazy read works.

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

### Lazy translate on Read

The plugin's `PreToolUse` hook (matcher `Read`): if the file is `.md`/`.mdx` with Cyrillic and the cache is missing or stale (sha mismatch), it translates via Haiku, caches under `~/.claude/translate-proxy/cache/<project>/…en.md`, and rewrites the tool call's `file_path` to the cache. It also injects a context note telling Claude to edit the **original** file, never the cache. Everything fails open: no CLI, quota exhausted, timeout → the original Russian file is read.

### Shared cache with cursor-translate

Before spending on a translation, the doc cache checks the **sibling install** — [cursor-translate](https://github.com/davlet42/cursor-translate) keeps the same cache format under `~/.cursor/translate-proxy`. A fresh entry (sha match against the current source) is copied over as `action: sibling_copy` with zero translate cost; only if the sibling is also missing or stale does a real translation run. Works in both directions: docs you translated in Cursor are reused by Claude Code and vice versa.

Config: `cache.share_siblings: true` (default). Override or disable: `CLAUDE_TRANSLATE_SIBLING_HOMES="/path/one:/path/two"` (empty string disables).

### CLAUDE.md workflow (biggest per-session win)

`CLAUDE.md` is loaded into **every** Claude Code session. Keep the Russian source in `CLAUDE.ru.md` and generate the English `CLAUDE.md`:

```bash
claude-translate claudemd            # first run: seeds CLAUDE.ru.md from a Russian CLAUDE.md
# edit CLAUDE.ru.md later…
claude-translate claudemd            # re-translate (sha marker tracks staleness)
claude-translate claudemd --check    # CI check: exit 1 when stale
```

### Full agent wrapper (headless)

```bash
claude-translate agent --model sonnet -- "сделай ревью PR и опиши риски"
```

```
User RU → Haiku (translate in)
       → claude -p (your model; hooks/doc-cache still active)
       → Haiku (translate out, optional — response.back_translate)
```

## Plugin contents

- **Hooks:** `PreToolUse` lazy read (600s timeout), `UserPromptSubmit`/`Stop` opportunity audits, `SessionStart` context note. All guarded by `CLAUDE_TRANSLATE_HOP=1` against recursion.
- **MCP:** `translate` + `resolve_doc` (reuses `@cursor-translate/mcp`; wrapper installed by `init` exports the Claude home).
- **Slash commands:** `/translate-docs` (warm cache), `/translate-report` (metrics summary).

## Metrics sources (`~/.claude/translate-proxy/metrics.jsonl`)

| `source` | Trigger |
|---|---|
| `doc_cache_served` | Lazy read / MCP served EN cache (realized savings) |
| `doc_translate_cost` | Doc translation spend (`reason: claudemd` for CLAUDE.md syncs) |
| `prompt_translated` / `response_back_translated` | CLI `agent` & `prompt`, MCP `translate` |
| `user_prompt` / `agent_response` | Opportunity audit from hooks (what auto-translate *would* save) |

## Config

`~/.claude/translate-proxy/config.yaml` (from `templates/config.yaml` on `init`):

```yaml
translator:
  provider: claude-cli
  model: claude-haiku-4-5
```

Custom translation rules: `.claude/claude-translate.md`, a `## claude-translate` section in `CLAUDE.md`/`AGENTS.md`, or `~/.claude/translate-proxy/claude-translate-rules.md`. Project glossary: `.claude/claude-translate-glossary.yaml`.

## Roadmap

- **MessageDisplay back-translate** — Claude Code's `MessageDisplay` hook can transform *displayed* text only: show replies in Russian while the transcript stays English (saves output tokens on every turn). Needs latency tuning.
- **PostToolUse variant** — serve EN content via `updatedToolOutput` without changing the path.
- Output-style preset nudging English-only replies for maximum savings with display-side RU.

## License

MIT
