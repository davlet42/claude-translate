import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendMetricsEntry, backTranslateResponse, countCyrillicRatio } from '@cursor-translate/core';
import { loadClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';
import { resolveClaudeTranslateHome } from '../claude-env.js';
import { readStdin } from '../helpers/read-stdin.js';

// MessageDisplay hook, real contract (differs from the docs): the event is a
// display STREAM — { message_id, turn_id, index, final, delta } — where delta
// is a text chunk and final marks the last chunk of a displayed message. In
// headless runs the whole message arrives as one final delta; interactive
// sessions fire many.
//
// IMPORTANT: chunk events for one message are dispatched CONCURRENTLY, with no
// ordering guarantee (verified 2026-07-11 on Claude Code 2.1.204: all four
// chunks of a 4.3k-char message hit the hook within the same second, and the
// final's drain saw only chunk 0 in the buffer — the middle chunks were still
// in flight in parallel hook processes). Reassembling the message from
// buffered deltas is therefore racy by design and translated only a fragment,
// or nothing, for long replies.
//
// The final chunk instead resolves the FULL message text from the session
// transcript: the event carries transcript_path, the assistant entry lands
// there in the same second the display stream fires, and the final delta is
// the message TAIL — so the newest assistant entry whose text ends with that
// delta is the displayed message. Buffered deltas remain only as a fallback
// for the case where the transcript has not caught up yet.
const BUFFER_FILE = 'display-buffer.jsonl';
const BUFFER_MAX_BYTES = 1024 * 1024;

// Transcript lookup: scan this many trailing transcript lines at most, and
// refuse to match on a tail shorter than this (too ambiguous — fall back to
// buffer assembly instead of risking a wrong-message repaint).
const TRANSCRIPT_SCAN_MAX_LINES = 400;
const TRANSCRIPT_NEEDLE_MIN_CHARS = 12;

interface DisplayDeltaEvent {
  messageId: string;
  index: number;
  final: boolean;
  delta: string;
}

function parseDeltaEvent(hookInput: Record<string, unknown>): DisplayDeltaEvent | null {
  if (typeof hookInput.delta !== 'string') {
    return null;
  }
  return {
    messageId: typeof hookInput.message_id === 'string' ? hookInput.message_id : 'unknown',
    index: typeof hookInput.index === 'number' ? hookInput.index : 0,
    final: hookInput.final === true,
    delta: hookInput.delta,
  };
}

// Group paragraphs into chunks around this size for parallel translation.
const DISPLAY_CHUNK_TARGET_CHARS = 1500;

export function splitForDisplay(text: string): string[] {
  if (text.length <= DISPLAY_CHUNK_TARGET_CHARS) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > DISPLAY_CHUNK_TARGET_CHARS && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }

  return chunks;
}

// Per-paragraph language gate. Core skips a whole translate call when the
// text is ≥15% Cyrillic ('already_ru') — correct for uniform text, but a
// mixed reply (Russian intro + English body) used to ride one chunk over the
// threshold and stay untranslated on screen. Segment by paragraph instead:
// Russian paragraphs pass through verbatim, consecutive English paragraphs
// batch into translate chunks. The 0.15 threshold mirrors core's gate.
const ALREADY_RU_RATIO = 0.15;
const LETTERS_RE = /[A-Za-zА-Яа-яЁё]/;

export interface DisplaySegment {
  text: string;
  translate: boolean;
}

function paragraphNeedsTranslation(paragraph: string): boolean {
  if (!LETTERS_RE.test(paragraph)) {
    return false; // separators, bare code/symbols — nothing to translate
  }
  return countCyrillicRatio(paragraph) < ALREADY_RU_RATIO;
}

export function segmentForDisplay(text: string): DisplaySegment[] {
  const paragraphs = text.split(/\n{2,}/);
  const segments: DisplaySegment[] = [];
  let run: string[] = [];
  let runTranslate: boolean | null = null;

  const flush = () => {
    if (!run.length || runTranslate === null) {
      return;
    }
    const joined = run.join('\n\n');
    if (runTranslate) {
      for (const chunk of splitForDisplay(joined)) {
        segments.push({ text: chunk, translate: true });
      }
    } else {
      segments.push({ text: joined, translate: false });
    }
    run = [];
  };

  for (const paragraph of paragraphs) {
    const translate = paragraphNeedsTranslation(paragraph);
    if (runTranslate !== null && translate !== runTranslate) {
      flush();
    }
    runTranslate = translate;
    run.push(paragraph);
  }
  flush();

  return segments;
}

function bufferPath(): string {
  return join(resolveClaudeTranslateHome(), BUFFER_FILE);
}

async function appendToBuffer(event: DisplayDeltaEvent): Promise<void> {
  await mkdir(resolveClaudeTranslateHome(), { recursive: true });
  await appendFile(
    bufferPath(),
    `${JSON.stringify({ message_id: event.messageId, index: event.index, delta: event.delta })}\n`,
    'utf8',
  );
}

// Collect buffered deltas for this message and drop them from the buffer.
// A buffer grown past the cap is stale junk from interrupted sessions — clear it.
async function drainBuffer(messageId: string): Promise<string> {
  let raw = '';
  try {
    raw = await readFile(bufferPath(), 'utf8');
  } catch {
    return '';
  }

  const mine: { index: number; delta: string }[] = [];
  const others: string[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as { message_id?: string; index?: number; delta?: string };
      if (entry.message_id === messageId && typeof entry.delta === 'string') {
        mine.push({ index: entry.index ?? 0, delta: entry.delta });
      } else {
        others.push(line);
      }
    } catch {
      // drop malformed lines
    }
  }

  const rest = others.join('\n');
  try {
    await writeFile(bufferPath(), rest.length > BUFFER_MAX_BYTES ? '' : rest ? `${rest}\n` : '', 'utf8');
  } catch {
    // buffer cleanup is best-effort
  }

  return mine
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.delta)
    .join('');
}

interface TranscriptHit {
  text: string;
  matched: 'ends_with' | 'includes';
}

// The displayed message's transcript entry: newest assistant entry whose text
// ends with the final delta (the tail of the displayed message). `includes` is
// the second-choice match for tails the terminal decorated (kept separate in
// metrics so a drifting contract shows up in `report`, not in silence).
export async function readFullMessageFromTranscript(
  transcriptPath: string,
  finalDelta: string,
): Promise<TranscriptHit | null> {
  const needle = finalDelta.trimEnd();
  if (needle.trim().length < TRANSCRIPT_NEEDLE_MIN_CHARS) {
    return null;
  }

  let raw: string;
  try {
    raw = await readFile(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  let includesHit: TranscriptHit | null = null;
  let scanned = 0;

  for (let i = lines.length - 1; i >= 0 && scanned < TRANSCRIPT_SCAN_MAX_LINES; i--) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    scanned++;
    // Cheap pre-filter before JSON.parse; transcript JSONL is unspaced.
    if (!line.includes('"type":"assistant"')) {
      continue;
    }

    let entry: { type?: unknown; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line) as { type?: unknown; message?: { content?: unknown } };
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) {
      continue;
    }

    const text = entry.message.content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string',
      )
      .map((block) => block.text)
      .join('\n\n');
    if (!text.trim()) {
      continue;
    }

    const candidate = text.trimEnd();
    if (candidate.endsWith(needle)) {
      return { text, matched: 'ends_with' };
    }
    if (!includesHit && candidate.includes(needle)) {
      includesHit = { text, matched: 'includes' };
    }
  }

  return includesHit;
}

type DisplayOutcomeReason =
  | 'unrecognized_payload'
  | 'empty_text'
  | 'below_min_chars'
  | 'above_max_chars'
  | 'quota_latched'
  | 'unchanged'
  | 'already_russian'
  | 'displayed'
  | 'hook_error';

// Every terminal outcome of the hook leaves a metrics trail. The silent `{}`
// exits are what made the concurrency bug undiagnosable — `report` and a
// plain grep over metrics.jsonl must be able to answer "why was this reply
// shown in English".
async function logDisplayOutcome(outcome: {
  reason: DisplayOutcomeReason;
  origin?: string;
  textChars?: number;
  servedChars?: number;
}): Promise<void> {
  try {
    await appendMetricsEntry({
      source: 'display_hook',
      reason: outcome.reason,
      action: outcome.origin,
      ru_tokens_est: 0,
      en_tokens_est: 0,
      saved_tokens_est: 0,
      text_chars: outcome.textChars,
      served_chars: outcome.servedChars,
    });
  } catch {
    // metrics must never break the display path
  }
}

export async function resolveDisplayFromHookInput(
  hookInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const extras = await loadClaudeConfigExtras();
  if (!extras.displayBackTranslate) {
    return {};
  }

  // Legacy/docs shape: full message in one field.
  let text = typeof hookInput.message_text === 'string' ? hookInput.message_text : '';
  let origin = text ? 'message_text' : '';

  if (!text) {
    const event = parseDeltaEvent(hookInput);
    if (!event) {
      await logDisplayOutcome({ reason: 'unrecognized_payload' });
      return {};
    }

    if (!event.final) {
      await appendToBuffer(event);
      return {};
    }

    const transcriptPath =
      typeof hookInput.transcript_path === 'string' ? hookInput.transcript_path : '';
    // The assistant entry lands in the transcript within the same second the
    // display stream fires, but can trail the final event by sub-second
    // margins (observed: event at :00.0-.9, entry at :00.681) — one short
    // retry closes that window before falling back to the racy buffer.
    let hit = transcriptPath
      ? await readFullMessageFromTranscript(transcriptPath, event.delta)
      : null;
    if (!hit && transcriptPath) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      hit = await readFullMessageFromTranscript(transcriptPath, event.delta);
    }

    if (hit) {
      text = hit.text;
      origin = `transcript_${hit.matched}`;
      // Buffered chunks for this message are redundant now — keep the buffer clean.
      await drainBuffer(event.messageId);
    } else {
      text = `${await drainBuffer(event.messageId)}${event.delta}`;
      origin = 'buffer_assembly';
    }
  }

  if (!text.trim()) {
    await logDisplayOutcome({ reason: 'empty_text', origin });
    return {};
  }
  if (text.length < extras.displayMinChars) {
    await logDisplayOutcome({ reason: 'below_min_chars', origin, textChars: text.length });
    return {};
  }
  if (text.length > extras.displayMaxChars) {
    await logDisplayOutcome({ reason: 'above_max_chars', origin, textChars: text.length });
    return {};
  }

  const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : undefined;

  // Russian paragraphs pass through verbatim; English runs are split into
  // chunks and translated in PARALLEL: the hook timeout is fixed, but a
  // sequential hop scales with reply length (a 2.5k reply took ~2min under
  // account throttling). Wall-clock becomes the slowest chunk instead of the sum.
  const segments = segmentForDisplay(text);

  if (!segments.some((segment) => segment.translate)) {
    await logDisplayOutcome({ reason: 'already_russian', origin, textChars: text.length });
    return {};
  }

  // backTranslateResponse applies its own gates (disabled, quota exhausted)
  // and logs response_back_translated metrics per chunk.
  const results = await Promise.all(
    segments.map((segment) => (segment.translate ? backTranslateResponse({ text: segment.text, cwd }) : null)),
  );

  // On quota exhaustion show the original but tell the user why — a silent
  // English reply reads as "the plugin is broken".
  const quotaHit = results.some(
    (r) => r !== null && r.skipped && (r.reason === 'quota_blocked' || r.reason === 'quota_exhausted'),
  );
  if (quotaHit) {
    await logDisplayOutcome({ reason: 'quota_latched', origin, textChars: text.length });
    return {
      systemMessage:
        'claude-translate: translate tier hit its usage limit; showing the original reply (retries automatically after cooldown).',
    };
  }

  const translated = segments
    .map((segment, i) => {
      const result = results[i];
      return result && !result.skipped ? result.text : segment.text;
    })
    .join('\n\n');

  if (translated === text) {
    await logDisplayOutcome({ reason: 'unchanged', origin, textChars: text.length });
    return {};
  }

  await logDisplayOutcome({
    reason: 'displayed',
    origin,
    textChars: text.length,
    servedChars: translated.length,
  });
  return {
    hookSpecificOutput: {
      hookEventName: 'MessageDisplay',
      displayContent: translated,
    },
  };
}

export async function runHookDisplay(): Promise<void> {
  let output: Record<string, unknown> = {};

  try {
    const raw = await readStdin();
    const input = JSON.parse(raw) as Record<string, unknown>;
    output = await resolveDisplayFromHookInput(input);
  } catch (error) {
    // Fail open: show the original message — but never silently. A swallowed
    // exception here (with the hook script discarding stderr on top) is
    // exactly what made the display pipeline undiagnosable.
    await logDisplayOutcome({
      reason: 'hook_error',
      origin: String(error instanceof Error ? error.message : error).slice(0, 160),
    });
    output = {};
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}
