import { copyFile, mkdir, writeFile, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { setupShellPath } from './setup-shell-path.js';
import { resolveClaudeTranslateHome } from '../claude-env.js';
import {
  resolveBundledCliEntry,
  resolveBundledMcpServer,
  resolveInitInstallRoot,
  resolveInitModuleDir,
} from '../helpers/resolve-init-paths.js';

const MODULE_DIR = resolveInitModuleDir();
const INSTALL_ROOT = resolveInitInstallRoot(MODULE_DIR);
const TRANSLATE_HOME = resolveClaudeTranslateHome();

// Hook scripts ship inside the plugin (referenced via ${CLAUDE_PLUGIN_ROOT});
// init also copies them into the home dir so a manual, plugin-less setup can
// point ~/.claude/settings.json hooks at stable paths.
const HOOK_SCRIPTS = [
  'translate-lazy-read.sh',
  'translate-post-read.sh',
  'translate-display.sh',
  'translate-audit-prompt.sh',
  'translate-audit-stop.sh',
  'translate-audit-subagent.sh',
  'translate-session-start.sh',
  'log-metrics.mjs',
] as const;

export interface InitOptions {
  dryRun?: boolean;
  skipHooks?: boolean;
  addPath?: boolean;
}

export interface InitResult {
  translateHome: string;
  created: string[];
  updated: string[];
  warnings: string[];
  pathSetup: {
    shellRcPath: string | null;
    added: boolean;
    alreadyPresent: boolean;
  } | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function installWrapper(
  wrapperName: string,
  scriptPath: string | null,
  dryRun: boolean,
  created: string[],
  updated: string[],
  options?: { exportClaudeEnv?: boolean },
): Promise<void> {
  if (!scriptPath || !(await exists(scriptPath))) {
    return;
  }

  const binDir = join(TRANSLATE_HOME, 'bin');
  const wrapperPath = join(binDir, wrapperName);
  const had = await exists(wrapperPath);

  // The reused @cursor-translate/mcp server reads CURSOR_TRANSLATE_HOME, so
  // the wrapper has to point it at the Claude home before exec.
  const envBlock = options?.exportClaudeEnv
    ? `export CURSOR_TRANSLATE_HOME="\${CLAUDE_TRANSLATE_HOME:-$HOME/.claude/translate-proxy}"
export CURSOR_TRANSLATE_DEFAULT_PROVIDER="\${CURSOR_TRANSLATE_DEFAULT_PROVIDER:-claude-cli}"
`
    : '';

  const wrapper = `#!/usr/bin/env bash
set -euo pipefail
${envBlock}exec node "${scriptPath}" "$@"
`;

  if (!dryRun) {
    await mkdir(binDir, { recursive: true });
    await writeFile(wrapperPath, wrapper, 'utf8');
    await chmod(wrapperPath, 0o755);
  }

  if (had) {
    updated.push(wrapperPath);
  } else {
    created.push(wrapperPath);
  }
}

async function ensureDir(path: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }
  await mkdir(path, { recursive: true });
}

async function copyTemplate(
  from: string,
  to: string,
  dryRun: boolean,
  created: string[],
): Promise<void> {
  if (!(await exists(from)) || (await exists(to))) {
    return;
  }
  if (!dryRun) {
    await copyFile(from, to);
  }
  created.push(to);
}

async function installHookAsset(
  filename: string,
  dryRun: boolean,
  created: string[],
  updated: string[],
): Promise<void> {
  const from = join(INSTALL_ROOT, 'plugin', 'hooks', filename);
  const dest = join(TRANSLATE_HOME, 'hooks', filename);

  if (!(await exists(from))) {
    return;
  }

  const had = await exists(dest);
  if (!dryRun) {
    await copyFile(from, dest);
    await chmod(dest, 0o755);
  }

  if (had) {
    updated.push(dest);
  } else {
    created.push(dest);
  }
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const dryRun = options.dryRun ?? false;
  const created: string[] = [];
  const updated: string[] = [];
  const warnings: string[] = [];

  await ensureDir(TRANSLATE_HOME, dryRun);
  await ensureDir(join(TRANSLATE_HOME, 'cache'), dryRun);
  await ensureDir(join(TRANSLATE_HOME, 'hooks'), dryRun);

  await copyTemplate(
    join(INSTALL_ROOT, 'templates', 'config.yaml'),
    join(TRANSLATE_HOME, 'config.yaml'),
    dryRun,
    created,
  );

  await copyTemplate(
    join(INSTALL_ROOT, 'plugin', 'glossary.default.yaml'),
    join(TRANSLATE_HOME, 'glossary.yaml'),
    dryRun,
    created,
  );

  if (!options.skipHooks) {
    for (const script of HOOK_SCRIPTS) {
      await installHookAsset(script, dryRun, created, updated);
    }
  }

  await installWrapper('claude-translate', resolveBundledCliEntry(MODULE_DIR), dryRun, created, updated);
  await installWrapper(
    'claude-translate-mcp',
    resolveBundledMcpServer(INSTALL_ROOT),
    dryRun,
    created,
    updated,
    { exportClaudeEnv: true },
  );

  await copyTemplate(
    join(INSTALL_ROOT, 'templates', 'claude-translate-rules.example.md'),
    join(TRANSLATE_HOME, 'claude-translate-rules.example.md'),
    dryRun,
    created,
  );

  let pathSetup: InitResult['pathSetup'] = null;
  if (options.addPath) {
    const pathResult = await setupShellPath(dryRun);
    pathSetup = {
      shellRcPath: pathResult.shellRcPath,
      added: pathResult.added,
      alreadyPresent: pathResult.alreadyPresent,
    };
  }

  return {
    translateHome: TRANSLATE_HOME,
    created,
    updated,
    warnings,
    pathSetup,
  };
}
