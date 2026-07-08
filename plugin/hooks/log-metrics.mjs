#!/usr/bin/env node
/**
 * Unified metrics logger for claude-translate opportunity audits.
 * Usage: SOURCE=... node log-metrics.mjs < hook.json
 *
 * Sources:
 *   user_prompt    — UserPromptSubmit hook (reads .prompt)
 *   agent_response — Stop hook (extracts last assistant message from transcript_path)
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME =
  process.env.CLAUDE_TRANSLATE_HOME ?? join(homedir(), '.claude', 'translate-proxy');
const METRICS_PATH = join(HOME, 'metrics.jsonl');
const CYRILLIC_RE = /[А-Яа-яЁё]/g;

const SOURCE = process.env.SOURCE ?? 'unknown';

const THRESHOLDS = {
  user_prompt: { minChars: 120, minCyrillic: 20 },
  agent_response: { minChars: 200, minCyrillic: 30 },
};

function countCyrillic(text) {
  return (text.match(CYRILLIC_RE) ?? []).length;
}

function estimateTokens(charCount, cyrillicCount) {
  const ratio = charCount > 0 ? cyrillicCount / charCount : 0;
  const base = Math.ceil(charCount / 3);
  const ruEst = ratio >= 0.05 ? Math.ceil(base * 1.8) : base;
  const enEst = Math.ceil(ruEst * 0.55);
  return { ruEst, enEst, saved: ruEst - enEst };
}

function extractTextBlocks(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

function lastAssistantMessageFromTranscript(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }

  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      const message = entry.message ?? entry;
      const role = message.role ?? entry.type;
      if (role === 'assistant') {
        const text = extractTextBlocks(message);
        if (text) {
          return text;
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return '';
}

function extractPayload(source, input) {
  switch (source) {
    case 'user_prompt':
      return { text: input.prompt ?? input.user_message ?? '', meta: {} };
    case 'agent_response': {
      const transcriptPath = input.transcript_path ?? null;
      const text = transcriptPath ? lastAssistantMessageFromTranscript(transcriptPath) : '';
      return { text, meta: {} };
    }
    default:
      return { text: '', meta: {} };
  }
}

function shouldLog(source, text, cyrillicCount) {
  const t = THRESHOLDS[source] ?? THRESHOLDS.user_prompt;
  return text.length >= t.minChars && cyrillicCount >= t.minCyrillic;
}

const raw = readFileSync(0, 'utf8');
const input = JSON.parse(raw);
const { text, meta } = extractPayload(SOURCE, input);
const cyrillicCount = countCyrillic(text);

if (!shouldLog(SOURCE, text, cyrillicCount)) {
  process.exit(0);
}

const ratio = text.length ? cyrillicCount / text.length : 0;
const { ruEst, enEst, saved } = estimateTokens(text.length, cyrillicCount);

const entry = {
  ts: new Date().toISOString(),
  source: SOURCE,
  session_id: input.session_id ?? null,
  reason: 'audit_opportunity',
  ru_tokens_est: ruEst,
  en_tokens_est: enEst,
  saved_tokens_est: saved,
  cyrillic_ratio: Number(ratio.toFixed(3)),
  text_chars: text.length,
  ...meta,
};

mkdirSync(HOME, { recursive: true });
appendFileSync(METRICS_PATH, `${JSON.stringify(entry)}\n`);
