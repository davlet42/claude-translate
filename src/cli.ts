#!/usr/bin/env node
import { configureClaudeEnvironment } from './claude-env.js';

configureClaudeEnvironment();

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'init':
      await handleInit(args.slice(1));
      break;
    case 'doc': {
      const { runDoc } = await import('./commands/doc.js');
      await runDoc(args.slice(1));
      break;
    }
    case 'docs': {
      const { runDocs } = await import('./commands/docs.js');
      await runDocs(args.slice(1));
      break;
    }
    case 'claudemd': {
      const { runClaudeMd } = await import('./commands/claudemd.js');
      await runClaudeMd(args.slice(1));
      break;
    }
    case 'resolve': {
      const { runResolve } = await import('./commands/resolve.js');
      await runResolve(args[1], args.slice(2));
      break;
    }
    case 'hook-resolve': {
      const { runHookResolve } = await import('./commands/hook-resolve.js');
      await runHookResolve();
      break;
    }
    case 'hook-display': {
      const { runHookDisplay } = await import('./commands/hook-display.js');
      await runHookDisplay();
      break;
    }
    case 'hook-post-read': {
      const { runHookPostRead } = await import('./commands/hook-post-read.js');
      await runHookPostRead();
      break;
    }
    case 'hook-session-start': {
      const { runHookSessionStart } = await import('./commands/hook-session-start.js');
      await runHookSessionStart();
      break;
    }
    case 'prompt': {
      const { runPrompt } = await import('./commands/prompt.js');
      await runPrompt(args.slice(1));
      break;
    }
    case 'agent': {
      const { runAgent } = await import('./commands/agent.js');
      await runAgent(args.slice(1));
      break;
    }
    case 'report': {
      if (args.slice(1).includes('--backfill-costs')) {
        const { runBackfillCosts } = await import('./commands/backfill-costs.js');
        await runBackfillCosts(args.slice(1).filter((a) => a !== '--backfill-costs'));
        break;
      }
      const { runReport, formatReport } = await import('./commands/report.js');
      const result = await runReport(args.slice(1));
      console.log(formatReport(result));
      break;
    }
    case 'backfill-costs': {
      const { runBackfillCosts } = await import('./commands/backfill-costs.js');
      await runBackfillCosts(args.slice(1));
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function handleInit(initArgs: string[]): Promise<void> {
  const { runInit } = await import('./commands/init.js');
  const { shellPathHint } = await import('./commands/setup-shell-path.js');

  const dryRun = initArgs.includes('--dry-run');
  const skipHooks = initArgs.includes('--skip-hooks');
  const addPath = initArgs.includes('--path');

  const result = await runInit({ dryRun, skipHooks, addPath });

  console.log('claude-translate init');
  console.log(`  home: ${result.translateHome}`);
  console.log(`  cli: ${result.translateHome}/bin/claude-translate`);
  if (result.created.length) {
    console.log('  created:');
    for (const p of result.created) {
      console.log(`    - ${p}`);
    }
  }
  if (result.updated.length) {
    console.log('  updated:');
    for (const p of result.updated) {
      console.log(`    - ${p}`);
    }
  }
  if (result.warnings.length) {
    console.log('  warnings:');
    for (const w of result.warnings) {
      console.log(`    - ${w}`);
    }
  }
  if (result.pathSetup) {
    if (result.pathSetup.alreadyPresent) {
      console.log(`  path: already in ${result.pathSetup.shellRcPath ?? 'shell rc'}`);
    } else if (result.pathSetup.added) {
      console.log(`  path: added to ${result.pathSetup.shellRcPath}`);
      console.log(`  ${shellPathHint(result.pathSetup.shellRcPath)}`);
    }
  } else if (!dryRun) {
    console.log('  tip: re-run with --path to add claude-translate to your shell PATH');
  }
  console.log('');
  console.log('Translate tier default model: claude-haiku-4-5 (Claude subscription via claude -p --safe-mode)');
  console.log('Lazy read: PreToolUse Read hook rewrites file_path to the EN cache (translate on miss/stale)');
  console.log('CLAUDE.md: run `claude-translate claudemd` to keep an English CLAUDE.md from a Russian source');
  console.log('');
  console.log('Enable the plugin (hooks + MCP + metrics) inside Claude Code:');
  console.log('  /plugin marketplace add davlet42/claude-translate');
  console.log('  /plugin install claude-translate@claude-translate');
}

function printHelp(): void {
  console.log(`claude-translate — token-saving RU→EN layer for Claude Code

Usage:
  claude-translate init [--dry-run] [--skip-hooks] [--path]
  claude-translate doc <file> [--project slug] [--force] [--dry-run]
  claude-translate docs [path] [--project slug] [--force] [--dry-run]
      [--include-gitignored] [--min-cyrillic-ratio 0.05] [--min-chars 80]
  claude-translate claudemd [path] [--check] [--force] [--dry-run]
  claude-translate resolve <file> [--json] [--project slug] [--force]
  claude-translate hook-resolve                    (stdin JSON → PreToolUse Read)
  claude-translate hook-post-read                  (stdin JSON → PostToolUse Read, lazy_read_mode: content)
  claude-translate hook-display                    (stdin JSON → MessageDisplay RU display translation)
  claude-translate hook-session-start              (SessionStart context note)
  claude-translate prompt "<text>" [--json] [--force] [--stdin]
  claude-translate agent [claude flags] -- "<prompt>" [--json] [--no-back-translate]
  claude-translate report [--days 7] [--backfill-costs] [--project slug]
  claude-translate backfill-costs [--project slug] [--dry-run]

Docs: https://github.com/davlet42/claude-translate
`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
