import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { before, describe, it } from 'node:test';

// Point both env names at an isolated home BEFORE importing the CLI modules.
const HOME = mkdtempSync(join(tmpdir(), 'claude-translate-test-'));
process.env.CLAUDE_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_HOME = HOME;
// Hermetic by default; the sibling-sharing test overrides this locally.
process.env.CURSOR_TRANSLATE_SIBLING_HOMES = '';

const PROJECT = mkdtempSync(join(tmpdir(), 'claude-translate-project-'));

const { runResolveFromHookInput } = await import('../dist/commands/resolve.js');

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeConfig(enabled) {
  writeFileSync(
    join(HOME, 'config.yaml'),
    `enabled: ${enabled}\n\ntranslator:\n  provider: claude-cli\n  model: claude-haiku-4-5\n`,
    'utf8',
  );
}

describe('runResolveFromHookInput (Claude PreToolUse contract)', () => {
  before(() => {
    writeConfig(true);
  });

  it('returns an empty object when file_path is missing', async () => {
    const output = await runResolveFromHookInput({ tool_input: {} });
    assert.deepEqual(output, {});
  });

  it('passes through non-markdown files untouched', async () => {
    const filePath = join(PROJECT, 'notes.txt');
    writeFileSync(filePath, 'Просто текст на русском языке для проверки.', 'utf8');

    const output = await runResolveFromHookInput({
      tool_input: { file_path: filePath },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
  });

  it('passes through markdown without Cyrillic', async () => {
    const filePath = join(PROJECT, 'english.md');
    writeFileSync(filePath, `# English doc\n\n${'All prose here is English. '.repeat(20)}`, 'utf8');

    const output = await runResolveFromHookInput({
      tool_input: { file_path: filePath },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
  });

  it('rewrites file_path to the EN cache on a warm cache hit', async () => {
    const sourceBody = `# Документация\n\n${'Это русский текст, который должен обслуживаться из английского кэша. '.repeat(10)}`;
    const sourcePath = join(PROJECT, 'ROADMAP.md');
    writeFileSync(sourcePath, sourceBody, 'utf8');

    // Seed a warm cache entry exactly as translateDocToGlobalCache would write it.
    // Project slug for a non-git dir falls back to the directory name.
    const projectSlug = basename(PROJECT);
    const cachePath = join(HOME, 'cache', projectSlug, 'ROADMAP.en.md');
    mkdirSync(join(HOME, 'cache', projectSlug), { recursive: true });
    writeFileSync(
      cachePath,
      `---\ncursor-translate-version: 1\ncursor-translate-source: ${sourcePath}\ncursor-translate-source-sha256: ${sha256Hex(sourceBody)}\ncursor-translate-generated-at: 2026-07-08T00:00:00.000Z\ncursor-translate-project: ${projectSlug}\n---\n\n# Documentation\n\nEnglish cached body.\n`,
      'utf8',
    );

    const output = await runResolveFromHookInput({
      tool_input: { file_path: sourcePath, limit: 100 },
      cwd: PROJECT,
    });

    const hookOutput = output.hookSpecificOutput;
    assert.ok(hookOutput, 'expected hookSpecificOutput on cache hit');
    assert.equal(hookOutput.hookEventName, 'PreToolUse');
    assert.equal(hookOutput.updatedInput.file_path, cachePath);
    assert.equal(hookOutput.updatedInput.limit, 100, 'other tool_input fields must be preserved');
    assert.match(hookOutput.additionalContext, /edit the original file/i);
  });

  it('fails open when translation is disabled', async () => {
    writeConfig(false);
    const sourcePath = join(PROJECT, 'DISABLED.md');
    writeFileSync(sourcePath, `# Заголовок\n\n${'Русский текст. '.repeat(30)}`, 'utf8');

    const output = await runResolveFromHookInput({
      tool_input: { file_path: sourcePath },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
    writeConfig(true);
  });

  it('reuses a fresh cursor-translate sibling cache instead of translating', async () => {
    const cursorHome = mkdtempSync(join(tmpdir(), 'claude-translate-cursor-home-'));
    process.env.CURSOR_TRANSLATE_SIBLING_HOMES = cursorHome;

    const sourceBody = `# Общий документ\n\n${'Этот файл уже переведён cursor-translate. '.repeat(10)}`;
    const sourcePath = join(PROJECT, 'SHARED.md');
    writeFileSync(sourcePath, sourceBody, 'utf8');

    const projectSlug = basename(PROJECT);
    mkdirSync(join(cursorHome, 'cache', projectSlug), { recursive: true });
    writeFileSync(
      join(cursorHome, 'cache', projectSlug, 'SHARED.en.md'),
      `---\ncursor-translate-version: 1\ncursor-translate-source: ${sourcePath}\ncursor-translate-source-sha256: ${sha256Hex(sourceBody)}\ncursor-translate-generated-at: 2026-07-08T00:00:00.000Z\ncursor-translate-project: ${projectSlug}\n---\n\n# Shared doc\n\nTranslated by cursor-translate.\n`,
      'utf8',
    );

    const output = await runResolveFromHookInput({
      tool_input: { file_path: sourcePath },
      cwd: PROJECT,
    });

    const expectedOwnCache = join(HOME, 'cache', projectSlug, 'SHARED.en.md');
    assert.equal(output.hookSpecificOutput?.updatedInput?.file_path, expectedOwnCache);
    assert.match(output.hookSpecificOutput?.additionalContext ?? '', /sibling_copy/);

    process.env.CURSOR_TRANSLATE_SIBLING_HOMES = '';
  });
});
