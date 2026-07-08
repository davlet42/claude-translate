import { spawnSync } from 'node:child_process';

export interface RunClaudeHeadlessOptions {
  claudeBinary?: string;
  args: string[];
  prompt: string;
}

export interface RunClaudeHeadlessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Full-featured headless run for the main agent hop: hooks, plugins, CLAUDE.md
// and MCP all stay enabled (unlike the --safe-mode translate hops), so the
// lazy-read doc cache keeps working inside the wrapped session.
export function runClaudeHeadless(options: RunClaudeHeadlessOptions): RunClaudeHeadlessResult {
  const claude = options.claudeBinary ?? process.env.CLAUDE_TRANSLATE_BIN ?? 'claude';
  const args = [...options.args];

  if (!args.includes('--print') && !args.includes('-p')) {
    args.push('--print');
  }
  if (!args.includes('--output-format')) {
    args.push('--output-format', 'text');
  }

  const result = spawnSync(claude, args, {
    encoding: 'utf8',
    input: options.prompt,
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60 * 60 * 1000,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}
