import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backTranslateResponse } from '@cursor-translate/core';
import { loadClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';
import { resolveClaudeTranslateHome } from '../claude-env.js';
import { readStdin } from '../helpers/read-stdin.js';

// MessageDisplay hook, real contract (differs from the docs): the event is a
// display STREAM — { message_id, turn_id, index, final, delta } — where delta
// is a text chunk and final marks the last chunk of a displayed message. In
// headless runs the whole message arrives as one final delta; interactive
// sessions may fire many. Non-final deltas are buffered; on the final event
// the full text is translated and returned as
// hookSpecificOutput.displayContent (display-only, transcript unaffected).
const BUFFER_FILE = 'display-buffer.jsonl';
const BUFFER_MAX_BYTES = 1024 * 1024;

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

export async function resolveDisplayFromHookInput(
  hookInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const extras = await loadClaudeConfigExtras();
  if (!extras.displayBackTranslate) {
    return {};
  }

  // Legacy/docs shape: full message in one field.
  let text = typeof hookInput.message_text === 'string' ? hookInput.message_text : '';

  if (!text) {
    const event = parseDeltaEvent(hookInput);
    if (!event) {
      return {};
    }

    if (!event.final) {
      await appendToBuffer(event);
      return {};
    }

    text = `${await drainBuffer(event.messageId)}${event.delta}`;
  }

  if (!text.trim()) {
    return {};
  }
  if (text.length < extras.displayMinChars || text.length > extras.displayMaxChars) {
    return {};
  }

  const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : undefined;

  // Long replies are split by paragraphs and translated in PARALLEL: the hook
  // timeout is fixed, but a sequential hop scales with reply length (a 2.5k
  // reply took ~2min under account throttling). Wall-clock becomes the
  // slowest chunk instead of the sum.
  const chunks = splitForDisplay(text);

  // backTranslateResponse applies its own gates (already Russian, disabled,
  // quota exhausted) and logs response_back_translated metrics per chunk.
  const results = await Promise.all(chunks.map((chunk) => backTranslateResponse({ text: chunk, cwd })));

  // On quota exhaustion show the original but tell the user why — a silent
  // English reply reads as "the plugin is broken".
  if (results.some((r) => r.skipped && (r.reason === 'quota_blocked' || r.reason === 'quota_exhausted'))) {
    return {
      systemMessage:
        'claude-translate: translate tier hit its usage limit; showing the original reply (retries automatically after cooldown).',
    };
  }

  const translated = results.map((r, i) => (r.skipped ? chunks[i] : r.text)).join('\n\n');

  if (translated === text) {
    return {};
  }

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
  } catch {
    // Fail open: show the original message.
    output = {};
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}
