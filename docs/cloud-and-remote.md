# Cloud and remote sessions

What claude-translate can do outside your local machine — Claude Code on the web, remote/background agents, CI. Split by what is verified versus assumed; contributions with verified findings welcome.

## Verified locally (baseline)

Everything in the [runtime guide](./runtime-guide.md) — lazy doc cache, display translation, `claudemd`, sibling cache, metrics — is verified on a local machine (macOS, Claude Code ≥ 2.1.198) where:

- the plugin is installed from the marketplace,
- `claude-translate init` has populated `~/.claude/translate-proxy` (config, hook assets, bin wrappers),
- the `claude-translate` npm package is installed globally.

Headless local runs (`claude -p`) are also verified: plugin hooks fire, lazy read serves EN content, MessageDisplay translates the printed output.

## Patterns that work anywhere (no hooks required)

These need nothing from the runtime environment, so they are the safe choice for cloud sessions:

1. **English `CLAUDE.md` committed to the repo** — the biggest cloud win. Run `claude-translate claudemd` locally, commit both `CLAUDE.ru.md` (source of truth) and the generated English `CLAUDE.md`. Every session anywhere — web, CI, teammates without the plugin — loads the cheap English version. Guard staleness in CI: `claude-translate claudemd --check` exits 1 when `CLAUDE.ru.md` changed after the last translation.
2. **Committed English doc copies** — for docs agents read constantly, keep a committed English version (e.g. `docs/en/…` generated with `claude-translate doc`) and reference it from `CLAUDE.md`. The global cache in `~/.claude/translate-proxy/cache` is per-machine and does not travel with the repo.
3. **MCP `translate` / `resolve_doc` in project scope** — a project `.mcp.json` can point at `claude-translate-mcp` so cloud agents can translate explicitly. Requires the npm package installed in the environment (see setup below).

## Assumed / not yet verified in cloud environments

- **Do user-scope plugins (and their hooks) load in Claude Code on the web?** Unverified. If they do, everything works as locally once init has run in the environment. If they don't, you fall back to the committed-docs patterns above.
- **Subscription-billed translate hops from a cloud VM** — `claude -p --safe-mode` relies on the environment's Anthropic auth. In managed cloud sessions auth exists by definition, but whether nested `claude -p` calls are permitted there is unverified. CI without a subscription: use `CLAUDE_TRANSLATE_PROVIDER=openai` + `OPENAI_API_KEY`.
- **MessageDisplay in non-terminal frontends** (web UI, IDE panels) — display transforms are a terminal-display feature; behavior elsewhere is undocumented.

## Environment setup snippet (CI / cloud with shell access)

```bash
npm install -g claude-translate
claude-translate init            # config + hook assets + bin wrappers
# optional, if the environment should translate rather than only consume caches:
export CLAUDE_TRANSLATE_PROVIDER=openai OPENAI_API_KEY=…   # when no subscription auth
claude-translate docs --dry-run  # see what would be translated
```

## Recommended split

| Concern | Local machine | Cloud / CI |
|---|---|---|
| CLAUDE.md | `claudemd` regenerates | committed EN version + `claudemd --check` gate |
| Project docs | lazy cache via hooks | committed EN copies for hot docs |
| Ad-hoc translation | hooks + CLI | MCP `translate` (project `.mcp.json`) |
| Metrics | `~/.claude/translate-proxy/metrics.jsonl` | per-environment, not aggregated |
