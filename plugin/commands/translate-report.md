---
description: Show claude-translate token-saving metrics (realized savings vs translate costs)
allowed-tools: Bash(claude-translate *), Bash(*/translate-proxy/bin/claude-translate *)
---

Run the claude-translate metrics report and summarize it for the user.

1. Run `claude-translate report --days 7`. If the binary is not on PATH, use `~/.claude/translate-proxy/bin/claude-translate report --days 7`.
2. Summarize: realized savings (doc_cache_served, prompt_translated), translate spend (doc_translate_cost warmup vs incremental), and remaining opportunity (user_prompt / agent_response audit rows).
3. If the report is empty, explain that metrics appear after the plugin hooks run or after `claude-translate docs` / `claudemd` are used.

$ARGUMENTS
