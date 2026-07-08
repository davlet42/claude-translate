import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BIN_DIR = join(homedir(), '.claude', 'translate-proxy', 'bin');
const PATH_EXPORT = `export PATH="${BIN_DIR}:$PATH"`;
const MARKER = '# claude-translate (added by claude-translate init --path)';

export interface SetupShellPathResult {
  shellRcPath: string | null;
  added: boolean;
  alreadyPresent: boolean;
  dryRun: boolean;
}

function resolveShellRcPath(): string | null {
  const shell = process.env.SHELL ?? '';
  const home = homedir();

  if (shell.includes('zsh')) {
    return join(home, '.zshrc');
  }
  if (shell.includes('bash')) {
    return join(home, '.bashrc');
  }

  return join(home, '.zshrc');
}

function pathLinePresent(content: string): boolean {
  return content.includes(BIN_DIR) || content.includes(MARKER);
}

export async function setupShellPath(dryRun = false): Promise<SetupShellPathResult> {
  const shellRcPath = resolveShellRcPath();

  if (!shellRcPath) {
    return { shellRcPath: null, added: false, alreadyPresent: false, dryRun };
  }

  let content = '';
  try {
    content = await readFile(shellRcPath, 'utf8');
  } catch {
    content = '';
  }

  if (pathLinePresent(content)) {
    return { shellRcPath, added: false, alreadyPresent: true, dryRun };
  }

  const block = `\n${MARKER}\n${PATH_EXPORT}\n`;

  if (!dryRun) {
    if (content.length === 0) {
      await writeFile(shellRcPath, `${block.trimStart()}\n`, 'utf8');
    } else {
      await appendFile(shellRcPath, block, 'utf8');
    }
  }

  return { shellRcPath, added: true, alreadyPresent: false, dryRun };
}

export function shellPathHint(shellRcPath: string | null): string {
  if (!shellRcPath) {
    return `Add manually: export PATH="${BIN_DIR}:$PATH"`;
  }
  return `Restart terminal or run: source ${shellRcPath}`;
}
