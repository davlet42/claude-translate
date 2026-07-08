import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveClaudeTranslateHome(): string {
  return process.env.CLAUDE_TRANSLATE_HOME ?? join(homedir(), '.claude', 'translate-proxy');
}

// @cursor-translate/core keys everything (config, cache, metrics, quota state)
// off CURSOR_TRANSLATE_HOME. Point it at the Claude home and default the
// provider to claude-cli so running without a config.yaml still works.
// Must be called before any core function reads the environment.
export function configureClaudeEnvironment(): void {
  process.env.CURSOR_TRANSLATE_HOME = resolveClaudeTranslateHome();
  process.env.CURSOR_TRANSLATE_DEFAULT_PROVIDER ??= 'claude-cli';
}
