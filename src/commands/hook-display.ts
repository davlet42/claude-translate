import { backTranslateResponse } from '@cursor-translate/core';
import { loadClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';
import { readStdin } from '../helpers/read-stdin.js';

// MessageDisplay hook contract: stdin carries
// { hook_event_name: "MessageDisplay", message_text, cwd, session_id };
// stdout may return hookSpecificOutput.displayContent to change ONLY what the
// user sees — the transcript (and what the model sees later) stays English.
export async function resolveDisplayFromHookInput(
  hookInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const text = typeof hookInput.message_text === 'string' ? hookInput.message_text : '';
  if (!text.trim()) {
    return {};
  }

  const extras = await loadClaudeConfigExtras();
  if (!extras.displayBackTranslate) {
    return {};
  }
  if (text.length < extras.displayMinChars || text.length > extras.displayMaxChars) {
    return {};
  }

  const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : undefined;

  // backTranslateResponse applies its own gates (already Russian, disabled,
  // quota exhausted) and logs response_back_translated metrics.
  const result = await backTranslateResponse({ text, cwd });

  if (result.skipped || result.text === text) {
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'MessageDisplay',
      displayContent: result.text,
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
