import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'claude-translate-transcript-home-'));
process.env.CLAUDE_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_HOME = HOME;
process.env.CURSOR_TRANSLATE_SIBLING_HOMES = '';

const { readFullMessageFromTranscript, resolveDisplayFromHookInput, segmentForDisplay } = await import(
  '../dist/commands/hook-display.js'
);

const BUFFER = join(HOME, 'display-buffer.jsonl');
const METRICS = join(HOME, 'metrics.jsonl');

function writeConfig({ display = true, enabled = true } = {}) {
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
      '  back_translate: true',
      `  display_back_translate: ${display}`,
      '  display_min_chars: 40',
      '',
    ].join('\n'),
    'utf8',
  );
}

function transcriptLine(entry) {
  return JSON.stringify(entry);
}

function assistantTextEntry(uuid, text) {
  return transcriptLine({
    type: 'assistant',
    uuid,
    timestamp: '2026-07-11T20:57:11.316Z',
    message: { id: `msg_${uuid}`, role: 'assistant', content: [{ type: 'text', text }] },
  });
}

const LONG_TEXT = [
  'First paragraph of a long assistant reply that streams as several display chunks.',
  'Middle paragraph carrying the bulk of the content, long enough to matter.',
  'Closing paragraph that arrives as the final display delta of the message.',
].join('\n\n');

function writeTranscript(lines) {
  const path = join(HOME, 'transcript.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function lastDisplayMetric() {
  const lines = readFileSync(METRICS, 'utf8').trim().split('\n');
  const mine = lines.map((l) => JSON.parse(l)).filter((e) => e.source === 'display_hook');
  return mine[mine.length - 1];
}

describe('readFullMessageFromTranscript', () => {
  it('finds the newest assistant entry whose text ends with the final delta', async () => {
    const path = writeTranscript([
      assistantTextEntry('older', `Unrelated earlier reply.\n\n${LONG_TEXT}`),
      transcriptLine({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'да' } }),
      assistantTextEntry('target', LONG_TEXT),
      transcriptLine({
        type: 'assistant',
        uuid: 'tooluse',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
      }),
    ]);

    const hit = await readFullMessageFromTranscript(
      path,
      'Closing paragraph that arrives as the final display delta of the message.\n\n',
    );
    assert.ok(hit, 'expected a transcript hit');
    assert.equal(hit.matched, 'ends_with');
    assert.equal(hit.text, LONG_TEXT);
  });

  it('falls back to an includes match when the tail is decorated', async () => {
    const path = writeTranscript([assistantTextEntry('only', `${LONG_TEXT}\n\n---\nfooter`)]);
    const hit = await readFullMessageFromTranscript(
      path,
      'Closing paragraph that arrives as the final display delta of the message.',
    );
    assert.ok(hit);
    assert.equal(hit.matched, 'includes');
  });

  it('returns null for a missing file, a short needle, and a no-match tail', async () => {
    const path = writeTranscript([assistantTextEntry('a', LONG_TEXT)]);
    assert.equal(await readFullMessageFromTranscript(join(HOME, 'absent.jsonl'), LONG_TEXT), null);
    assert.equal(await readFullMessageFromTranscript(path, 'short'), null);
    assert.equal(await readFullMessageFromTranscript(path, 'A tail that appears nowhere in the transcript.'), null);
  });

  it('skips malformed lines instead of failing', async () => {
    const path = writeTranscript([
      '{"type":"assistant", broken json',
      assistantTextEntry('ok', LONG_TEXT),
    ]);
    const hit = await readFullMessageFromTranscript(
      path,
      'Closing paragraph that arrives as the final display delta of the message.',
    );
    assert.ok(hit);
    assert.equal(hit.matched, 'ends_with');
  });
});

describe('resolveDisplayFromHookInput (transcript-first final)', () => {
  it('resolves the full text from the transcript and cleans buffered chunks', async () => {
    // enabled:false keeps the test hermetic (no claude spawn): the transcript
    // text is assembled, translation skips as disabled, outcome is `unchanged`.
    writeConfig({ display: true, enabled: false });
    const path = writeTranscript([assistantTextEntry('m1', LONG_TEXT)]);

    // Simulate the race: only chunk 0 made it into the buffer before final.
    await resolveDisplayFromHookInput({
      delta: 'First paragraph of a long assistant reply that streams as several display chunks.\n\n',
      message_id: 'display-m1',
      index: 0,
      final: false,
    });

    const output = await resolveDisplayFromHookInput({
      delta: 'Closing paragraph that arrives as the final display delta of the message.\n\n',
      message_id: 'display-m1',
      index: 3,
      final: true,
      transcript_path: path,
    });
    assert.deepEqual(output, {});

    const metric = lastDisplayMetric();
    assert.equal(metric.reason, 'unchanged');
    assert.equal(metric.action, 'transcript_ends_with');
    assert.equal(metric.text_chars, LONG_TEXT.length, 'must translate the FULL message, not a fragment');

    const buffered = readFileSync(BUFFER, 'utf8');
    assert.ok(!buffered.includes('display-m1'), 'buffered chunks must be drained on a transcript hit');
  });

  it('falls back to buffer assembly when the transcript has no match', async () => {
    writeConfig({ display: true, enabled: false });
    const path = writeTranscript([assistantTextEntry('m2', 'A completely different reply.')]);

    const output = await resolveDisplayFromHookInput({
      delta: 'A final delta long enough for thresholds but absent from the transcript entirely.',
      message_id: 'display-m2',
      index: 0,
      final: true,
      transcript_path: path,
    });
    assert.deepEqual(output, {});

    const metric = lastDisplayMetric();
    assert.equal(metric.reason, 'unchanged');
    assert.equal(metric.action, 'buffer_assembly');
  });

  it('logs unrecognized payloads instead of exiting silently', async () => {
    writeConfig({ display: true });
    const output = await resolveDisplayFromHookInput({ unexpected: 'shape' });
    assert.deepEqual(output, {});

    const metric = lastDisplayMetric();
    assert.equal(metric.reason, 'unrecognized_payload');
  });

  it('classifies a fully Russian reply as already_russian without any translate call', async () => {
    // enabled stays TRUE: the assertion is that segmentation short-circuits
    // before backTranslateResponse is ever invoked (reason must be
    // already_russian, not a per-chunk skip surfacing as unchanged).
    writeConfig({ display: true, enabled: true });
    const ru = 'Это полностью русский ответ ассистента, достаточно длинный для всех порогов отображения.';
    const path = writeTranscript([assistantTextEntry('m-ru', ru)]);

    const output = await resolveDisplayFromHookInput({
      delta: ru,
      message_id: 'display-m-ru',
      index: 0,
      final: true,
      transcript_path: path,
    });
    assert.deepEqual(output, {});

    const metric = lastDisplayMetric();
    assert.equal(metric.reason, 'already_russian');
    assert.equal(metric.action, 'transcript_ends_with');
  });

  it('logs the above_max_chars gate that used to be silent', async () => {
    writeConfig({ display: true, enabled: false });
    const tail = 'closing tail marker of the oversized assistant message for the size gate.';
    const path = writeTranscript([assistantTextEntry('m3', `${'x'.repeat(13000)}\n\n${tail}`)]);
    const output = await resolveDisplayFromHookInput({
      delta: tail,
      message_id: 'display-m3',
      index: 0,
      final: true,
      transcript_path: path,
    });
    assert.deepEqual(output, {});

    const metric = lastDisplayMetric();
    assert.equal(metric.reason, 'above_max_chars');
    assert.equal(metric.action, 'transcript_ends_with');
  });
});

describe('segmentForDisplay (per-paragraph language gate)', () => {
  const RU = 'Русское вступление, которое раньше утаскивало весь чанк за порог кириллицы целиком.';
  const EN1 = 'First English paragraph that must be translated for display.';
  const EN2 = 'Second English paragraph that continues the same run.';

  it('keeps Russian paragraphs verbatim and batches consecutive English ones', () => {
    const segments = segmentForDisplay([RU, EN1, EN2, RU].join('\n\n'));
    assert.deepEqual(
      segments.map((s) => s.translate),
      [false, true, false],
    );
    assert.equal(segments[0].text, RU);
    assert.equal(segments[1].text, `${EN1}\n\n${EN2}`);
    assert.equal(
      segments.map((s) => s.text).join('\n\n'),
      [RU, EN1, EN2, RU].join('\n\n'),
      'reassembly must reproduce the message',
    );
  });

  it('treats letterless separators as verbatim glue', () => {
    const segments = segmentForDisplay([RU, '---', EN1].join('\n\n'));
    assert.deepEqual(
      segments.map((s) => s.translate),
      [false, true],
    );
    assert.equal(segments[0].text, `${RU}\n\n---`);
  });

  it('splits an oversized English run into multiple translate chunks', () => {
    const para = 'An English paragraph of very reasonable length repeated for size. '.repeat(6).trim();
    const segments = segmentForDisplay([para, para, para, para].join('\n\n'));
    assert.ok(segments.length > 1);
    assert.ok(segments.every((s) => s.translate));
    assert.ok(segments.every((s) => s.text.length <= 2100));
  });
});
