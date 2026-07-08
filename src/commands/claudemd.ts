import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  appendMetricsEntry,
  countCyrillicRatio,
  estimateTokenSavings,
  loadGlossaryTerms,
  loadTranslateConfig,
  loadTranslateRules,
  resolveProjectRoot,
  translateMarkdownClaudeCli,
} from '@cursor-translate/core';

const RU_SOURCE_NAME = 'CLAUDE.ru.md';
const TARGET_NAME = 'CLAUDE.md';
const MARKER_PATTERN = /<!--\s*claude-translate:\s*source=(\S+)\s+sha256=([0-9a-f]{64})/;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildMarker(sourceSha: string): string {
  return `<!-- claude-translate: source=${RU_SOURCE_NAME} sha256=${sourceSha} — auto-generated English translation. Edit ${RU_SOURCE_NAME}, then run: claude-translate claudemd -->`;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function markerSha(claudeMdContent: string | null): string | null {
  if (!claudeMdContent) {
    return null;
  }
  const match = claudeMdContent.match(MARKER_PATTERN);
  return match ? match[2] : null;
}

export async function runClaudeMd(args: string[]): Promise<void> {
  const check = args.includes('--check');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const pathArg = args.find((a) => !a.startsWith('--'));

  const cwd = pathArg ? resolve(process.cwd(), pathArg) : process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const targetPath = join(projectRoot, TARGET_NAME);
  const ruPath = join(projectRoot, RU_SOURCE_NAME);

  const targetRaw = await readOptional(targetPath);
  let ruRaw = await readOptional(ruPath);

  console.log('claude-translate claudemd');
  console.log(`  project: ${projectRoot}`);

  // Seed the Russian source from an untranslated Cyrillic CLAUDE.md.
  if (ruRaw === null) {
    if (targetRaw === null) {
      console.log(`  status: no ${TARGET_NAME} or ${RU_SOURCE_NAME} found; nothing to do`);
      return;
    }

    const config = await loadTranslateConfig();
    const ratio = countCyrillicRatio(targetRaw);
    if (ratio < config.minCyrillicRatio) {
      console.log(`  status: ${TARGET_NAME} has no significant Cyrillic (ratio ${ratio.toFixed(2)}); nothing to do`);
      return;
    }

    if (check) {
      console.log(`  status: ${TARGET_NAME} is Russian and untranslated (run claude-translate claudemd)`);
      process.exitCode = 1;
      return;
    }

    if (dryRun) {
      console.log(`  would: move ${TARGET_NAME} → ${RU_SOURCE_NAME}, translate, write English ${TARGET_NAME}`);
      return;
    }

    await writeFile(ruPath, targetRaw, 'utf8');
    console.log(`  seeded: ${ruPath} (Russian source of truth)`);
    ruRaw = targetRaw;
  }

  const sourceSha = sha256Hex(ruRaw);
  const existingSha = markerSha(targetRaw);

  if (!force && existingSha === sourceSha) {
    console.log(`  status: up to date (${TARGET_NAME} matches ${RU_SOURCE_NAME} sha ${sourceSha.slice(0, 12)}…)`);
    return;
  }

  if (check) {
    if (existingSha === null) {
      console.log(`  status: stale — ${TARGET_NAME} has no claude-translate marker`);
    } else {
      console.log(`  status: stale — ${RU_SOURCE_NAME} changed since last translation`);
    }
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`  would: translate ${RU_SOURCE_NAME} → ${TARGET_NAME} (sha ${sourceSha.slice(0, 12)}…)`);
    return;
  }

  const config = await loadTranslateConfig();
  const [glossaryTerms, customRules] = await Promise.all([
    loadGlossaryTerms(projectRoot),
    loadTranslateRules(projectRoot),
  ]);

  const result = translateMarkdownClaudeCli(ruRaw, {
    model: config.model,
    fallbackModel: config.docFallbackModel,
    glossaryTerms,
    customRules,
    allowFallback: true,
  });

  if (result.quotaExhausted) {
    throw new Error('translate quota exhausted; CLAUDE.md left unchanged — retry later');
  }

  const body = result.text.trimEnd();
  await writeFile(targetPath, `${buildMarker(sourceSha)}\n\n${body}\n`, 'utf8');

  const savings = estimateTokenSavings(ruRaw, countCyrillicRatio(ruRaw), 0);
  await appendMetricsEntry({
    source: 'doc_translate_cost',
    reason: 'claudemd',
    ru_tokens_est: savings.ruTokensEst,
    en_tokens_est: savings.enTokensEst,
    saved_tokens_est: savings.savedTokensEst,
    translate_cost_tokens_est: Math.ceil(ruRaw.length / 3) + Math.ceil(body.length / 4),
    file_path: ruPath,
    cache_path: targetPath,
    translate_model: result.modelUsed,
    used_fallback: result.usedFallback,
    text_chars: ruRaw.length,
  });

  console.log(`  translated: ${RU_SOURCE_NAME} → ${TARGET_NAME} (${result.modelUsed}${result.usedFallback ? ', fallback' : ''})`);
  console.log(`  est. saving: ~${savings.savedTokensEst} tokens on every Claude Code session that loads ${TARGET_NAME}`);
}
