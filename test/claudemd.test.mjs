import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'claude-translate-claudemd-home-'));
process.env.CLAUDE_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_HOME = HOME;

const { runClaudeMd } = await import('../dist/commands/claudemd.js');

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function freshProject() {
  return mkdtempSync(join(tmpdir(), 'claude-translate-claudemd-'));
}

describe('claudemd', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('does nothing when no CLAUDE.md exists', async () => {
    const project = freshProject();
    await runClaudeMd([project]);
    assert.ok(!existsSync(join(project, 'CLAUDE.ru.md')));
    assert.ok(!existsSync(join(project, 'CLAUDE.md')));
  });

  it('does nothing for an English CLAUDE.md', async () => {
    const project = freshProject();
    writeFileSync(
      join(project, 'CLAUDE.md'),
      `# Project\n\n${'English instructions only. '.repeat(20)}`,
      'utf8',
    );
    await runClaudeMd([project]);
    assert.ok(!existsSync(join(project, 'CLAUDE.ru.md')));
  });

  it('--check exits 1 for an untranslated Russian CLAUDE.md', async () => {
    const project = freshProject();
    writeFileSync(
      join(project, 'CLAUDE.md'),
      `# Проект\n\n${'Инструкции на русском языке для агента. '.repeat(20)}`,
      'utf8',
    );
    await runClaudeMd([project, '--check']);
    assert.equal(process.exitCode, 1);
    assert.ok(!existsSync(join(project, 'CLAUDE.ru.md')), '--check must not write files');
  });

  it('recognizes an up-to-date translation via the sha marker', async () => {
    const project = freshProject();
    const ruBody = `# Проект\n\n${'Русские инструкции. '.repeat(20)}`;
    writeFileSync(join(project, 'CLAUDE.ru.md'), ruBody, 'utf8');
    writeFileSync(
      join(project, 'CLAUDE.md'),
      `<!-- claude-translate: source=CLAUDE.ru.md sha256=${sha256Hex(ruBody)} — auto-generated English translation. Edit CLAUDE.ru.md, then run: claude-translate claudemd -->\n\n# Project\n\nEnglish body.\n`,
      'utf8',
    );

    await runClaudeMd([project, '--check']);
    assert.equal(process.exitCode, 0, 'matching sha must be treated as up to date');
  });

  it('--check exits 1 when CLAUDE.ru.md changed after translation', async () => {
    const project = freshProject();
    writeFileSync(join(project, 'CLAUDE.ru.md'), `# Проект\n\nНовый русский текст.`, 'utf8');
    writeFileSync(
      join(project, 'CLAUDE.md'),
      `<!-- claude-translate: source=CLAUDE.ru.md sha256=${'0'.repeat(64)} -->\n\n# Project\n\nStale body.\n`,
      'utf8',
    );

    await runClaudeMd([project, '--check']);
    assert.equal(process.exitCode, 1);
  });
});
