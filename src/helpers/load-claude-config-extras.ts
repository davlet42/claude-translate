import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveClaudeTranslateHome } from '../claude-env.js';

// Claude-specific config keys parsed locally so @cursor-translate/core does
// not need to know about them. Same minimal-YAML approach as the core loader.
export interface ClaudeConfigExtras {
  displayBackTranslate: boolean;
  displayMinChars: number;
  displayMaxChars: number;
  englishReplies: boolean;
  lazyReadMode: 'path' | 'content';
}

export const CLAUDE_CONFIG_EXTRAS_DEFAULTS: ClaudeConfigExtras = {
  displayBackTranslate: false,
  displayMinChars: 80,
  // MessageDisplay hooks run per displayed message; huge replies would take
  // too long to translate, so skip beyond this size.
  displayMaxChars: 12000,
  englishReplies: false,
  lazyReadMode: 'path',
};

function parseNestedScalar(block: string, section: string, key: string): string | null {
  // Section body = consecutive indented or blank lines after "section:".
  const sectionMatch = block.match(
    new RegExp(`^${section}:[ \\t]*\\r?\\n((?:(?:[ \\t]+[^\\n]*)?\\r?\\n)*)`, 'm'),
  );
  if (!sectionMatch) {
    return null;
  }
  const match = sectionMatch[1].match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
  if (!match) {
    return null;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseLazyReadMode(value: string | null): 'path' | 'content' {
  return value === 'content' ? 'content' : 'path';
}

export async function loadClaudeConfigExtras(): Promise<ClaudeConfigExtras> {
  const configPath = join(resolveClaudeTranslateHome(), 'config.yaml');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    return { ...CLAUDE_CONFIG_EXTRAS_DEFAULTS };
  }

  return {
    displayBackTranslate: parseBoolean(
      parseNestedScalar(raw, 'response', 'display_back_translate'),
      CLAUDE_CONFIG_EXTRAS_DEFAULTS.displayBackTranslate,
    ),
    displayMinChars: parseNumber(
      parseNestedScalar(raw, 'response', 'display_min_chars'),
      CLAUDE_CONFIG_EXTRAS_DEFAULTS.displayMinChars,
    ),
    displayMaxChars: parseNumber(
      parseNestedScalar(raw, 'response', 'display_max_chars'),
      CLAUDE_CONFIG_EXTRAS_DEFAULTS.displayMaxChars,
    ),
    englishReplies: parseBoolean(
      parseNestedScalar(raw, 'response', 'english_replies'),
      CLAUDE_CONFIG_EXTRAS_DEFAULTS.englishReplies,
    ),
    lazyReadMode: parseLazyReadMode(parseNestedScalar(raw, 'hooks', 'lazy_read_mode')),
  };
}
