import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'claude-translate-display-home-'));
process.env.CLAUDE_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_SIBLING_HOMES = '';

const PROJECT = mkdtempSync(join(tmpdir(), 'claude-translate-display-project-'));

const { loadClaudeConfigExtras, CLAUDE_CONFIG_EXTRAS_DEFAULTS } = await import(
  '../dist/helpers/load-claude-config-extras.js'
);
const { resolveDisplayFromHookInput, splitForDisplay } = await import(
  '../dist/commands/hook-display.js'
);
const { resolvePostReadFromHookInput } = await import('../dist/commands/hook-post-read.js');
const { runResolveFromHookInput } = await import('../dist/commands/resolve.js');
const { buildSessionStartNote } = await import('../dist/commands/hook-session-start.js');

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeConfig({ display = false, englishReplies = false, mode = 'path', enabled = true } = {}) {
  writeFileSync(
    join(HOME, 'config.yaml'),
    [
      `enabled: ${enabled}`,
      '',
      'translator:',
      '  provider: claude-cli',
      '  model: claude-haiku-4-5',
      '',
      'response:',
      '  prompt_translate: true',
      '  back_translate: true',
      `  display_back_translate: ${display}`,
      '  display_min_chars: 40',
      `  english_replies: ${englishReplies}`,
      '',
      'hooks:',
      `  lazy_read_mode: ${mode}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function seedOwnCache(sourcePath, sourceBody, enBody) {
  const slug = basename(PROJECT);
  mkdirSync(join(HOME, 'cache', slug), { recursive: true });
  const cachePath = join(HOME, 'cache', slug, `${basename(sourcePath).replace(/\.md$/, '')}.en.md`);
  writeFileSync(
    cachePath,
    `---\ncursor-translate-version: 1\ncursor-translate-source: ${sourcePath}\ncursor-translate-source-sha256: ${sha256Hex(sourceBody)}\ncursor-translate-generated-at: 2026-07-08T00:00:00.000Z\ncursor-translate-project: ${slug}\n---\n\n${enBody}\n`,
    'utf8',
  );
  return cachePath;
}

describe('loadClaudeConfigExtras', () => {
  it('returns defaults when config is missing keys', async () => {
    writeConfig({});
    const extras = await loadClaudeConfigExtras();
    assert.equal(extras.displayBackTranslate, false);
    assert.equal(extras.displayMinChars, 40);
    assert.equal(extras.displayMaxChars, CLAUDE_CONFIG_EXTRAS_DEFAULTS.displayMaxChars);
    assert.equal(extras.englishReplies, false);
    assert.equal(extras.lazyReadMode, 'path');
  });

  it('parses enabled feature keys', async () => {
    writeConfig({ display: true, englishReplies: true, mode: 'content' });
    const extras = await loadClaudeConfigExtras();
    assert.equal(extras.displayBackTranslate, true);
    assert.equal(extras.englishReplies, true);
    assert.equal(extras.lazyReadMode, 'content');
  });
});

describe('resolveDisplayFromHookInput (MessageDisplay contract)', () => {
  const BUFFER = join(HOME, 'display-buffer.jsonl');

  it('does nothing when the feature is disabled', async () => {
    writeConfig({ display: false });
    const output = await resolveDisplayFromHookInput({
      delta: 'A long enough English assistant reply for the threshold check.',
      message_id: 'm-disabled',
      index: 0,
      final: true,
    });
    assert.deepEqual(output, {});
  });

  it('buffers non-final deltas and returns nothing', async () => {
    writeConfig({ display: true });
    const output = await resolveDisplayFromHookInput({
      delta: 'First streamed chunk of an English reply, ',
      message_id: 'm-stream',
      index: 0,
      final: false,
    });
    assert.deepEqual(output, {});

    const buffered = readFileSync(BUFFER, 'utf8');
    assert.match(buffered, /m-stream/);
    assert.match(buffered, /First streamed chunk/);
  });

  it('drains the buffer for the message on the final delta', async () => {
    writeConfig({ display: true, enabled: false });
    // enabled:false keeps the test hermetic (no claude spawn) while still
    // exercising the buffer drain: the full text is assembled, then the
    // translation layer skips as disabled.
    const output = await resolveDisplayFromHookInput({
      delta: 'and the final chunk long enough to pass the threshold together.',
      message_id: 'm-stream',
      index: 1,
      final: true,
    });
    assert.deepEqual(output, {});

    const buffered = readFileSync(BUFFER, 'utf8');
    assert.ok(!buffered.includes('m-stream'), 'processed deltas must leave the buffer');
    writeConfig({ display: true });
  });

  it('skips short final messages', async () => {
    writeConfig({ display: true });
    const output = await resolveDisplayFromHookInput({
      delta: 'Short reply.',
      message_id: 'm-short',
      index: 0,
      final: true,
    });
    assert.deepEqual(output, {});
  });

  it('skips replies that are already Russian', async () => {
    writeConfig({ display: true });
    const output = await resolveDisplayFromHookInput({
      delta: 'Это уже русский ответ ассистента, переводить его обратно не нужно совсем.',
      message_id: 'm-ru',
      index: 0,
      final: true,
    });
    assert.deepEqual(output, {});
  });

  it('still supports the documented message_text shape', async () => {
    writeConfig({ display: true, enabled: false });
    const output = await resolveDisplayFromHookInput({
      message_text: 'A long enough English assistant reply for the threshold check.',
    });
    assert.deepEqual(output, {});
    writeConfig({ display: true });
  });

  it('reports the quota latch via systemMessage instead of staying silent', async () => {
    writeConfig({ display: true });
    writeFileSync(
      join(HOME, 'doc-translate-quota.json'),
      JSON.stringify({ exhaustedAt: new Date().toISOString(), reason: 'test latch' }),
      'utf8',
    );

    const output = await resolveDisplayFromHookInput({
      delta: 'An English assistant reply that is definitely long enough to pass thresholds.',
      message_id: 'm-quota',
      index: 0,
      final: true,
    });

    assert.match(String(output.systemMessage ?? ''), /usage limit/i);
    writeFileSync(join(HOME, 'doc-translate-quota.json'), '', 'utf8');
  });
});

describe('splitForDisplay', () => {
  it('keeps short texts as a single chunk', () => {
    assert.deepEqual(splitForDisplay('Short reply.'), ['Short reply.']);
  });

  it('splits long texts by paragraphs and preserves the content', () => {
    const paragraph = 'A sentence of reasonable length repeated to build a paragraph. '.repeat(8).trim();
    const text = [paragraph, paragraph, paragraph, paragraph].join('\n\n');

    const chunks = splitForDisplay(text);
    assert.ok(chunks.length > 1, 'long text must produce multiple chunks');
    assert.equal(chunks.join('\n\n'), text, 'rejoined chunks must reproduce the text');
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 2100, `chunk unexpectedly large: ${chunk.length}`);
    }
  });

  it('does not split a single oversized paragraph', () => {
    const huge = 'word '.repeat(600).trim();
    assert.deepEqual(splitForDisplay(huge), [huge]);
  });
});

describe('resolvePostReadFromHookInput (PostToolUse contract)', () => {
  it('does nothing in path mode', async () => {
    writeConfig({ mode: 'path' });
    const output = await resolvePostReadFromHookInput({
      tool_name: 'Read',
      tool_input: { file_path: join(PROJECT, 'ANY.md') },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
  });

  it('ignores non-markdown files in content mode', async () => {
    writeConfig({ mode: 'content' });
    const output = await resolvePostReadFromHookInput({
      tool_name: 'Read',
      tool_input: { file_path: join(PROJECT, 'main.ts') },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
  });

  it('replaces file.content with the English translation, preserving the Read response shape', async () => {
    writeConfig({ mode: 'content' });
    const sourceBody = `# Русский документ\n\n${'Абзац русского текста для проверки подмены содержимого. '.repeat(6)}`;
    const sourcePath = join(PROJECT, 'CONTENT.md');
    writeFileSync(sourcePath, sourceBody, 'utf8');
    seedOwnCache(sourcePath, sourceBody, '# English doc\n\nFirst line.\nSecond line.');

    const output = await resolvePostReadFromHookInput({
      tool_name: 'Read',
      tool_input: { file_path: sourcePath },
      tool_response: {
        type: 'text',
        file: {
          filePath: sourcePath,
          content: sourceBody,
          numLines: 3,
          startLine: 1,
          totalLines: 3,
        },
      },
      cwd: PROJECT,
    });

    const hookOutput = output.hookSpecificOutput;
    assert.ok(hookOutput, 'expected hookSpecificOutput in content mode');
    assert.equal(hookOutput.hookEventName, 'PostToolUse');

    const updated = hookOutput.updatedToolOutput;
    assert.equal(updated.type, 'text', 'response shape must be preserved');
    assert.equal(updated.file.filePath, sourcePath, 'original path must stay visible');
    assert.match(updated.file.content, /^# English doc/);
    assert.match(updated.file.content, /Second line\./);
    assert.equal(updated.file.numLines, updated.file.totalLines);
    assert.equal(updated.file.startLine, 1);
    assert.match(hookOutput.additionalContext, /edit the original file/i);
  });

  it('fails open when the tool response shape is unknown', async () => {
    writeConfig({ mode: 'content' });
    const sourcePath = join(PROJECT, 'CONTENT.md');

    const output = await resolvePostReadFromHookInput({
      tool_name: 'Read',
      tool_input: { file_path: sourcePath },
      tool_response: 'plain string output',
      cwd: PROJECT,
    });

    assert.deepEqual(output, {});
  });

  it('PreToolUse rewrite is disabled while content mode is active', async () => {
    writeConfig({ mode: 'content' });
    const sourcePath = join(PROJECT, 'CONTENT.md');
    const output = await runResolveFromHookInput({
      tool_input: { file_path: sourcePath },
      cwd: PROJECT,
    });
    assert.deepEqual(output, {});
  });
});

describe('buildSessionStartNote', () => {
  it('adds the english-replies instruction only when both flags are on', () => {
    const base = { ...CLAUDE_CONFIG_EXTRAS_DEFAULTS };
    assert.ok(!buildSessionStartNote(base).includes('Respond in English'));
    assert.ok(
      !buildSessionStartNote({ ...base, englishReplies: true }).includes('Respond in English'),
      'english_replies without display translation must not switch reply language',
    );
    assert.ok(
      buildSessionStartNote({
        ...base,
        englishReplies: true,
        displayBackTranslate: true,
      }).includes('Respond in English'),
    );
  });
});
