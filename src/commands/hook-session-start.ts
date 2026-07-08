import type { ClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';
import { loadClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';

const BASE_NOTE =
  'claude-translate is active: Russian/Cyrillic markdown docs are transparently served as cached English translations when Read (token saving). To modify such a doc, edit the original file path from the project, never the cache under ~/.claude/translate-proxy/cache. MCP tools `translate` and `resolve_doc` are available for explicit translation.';

const ENGLISH_REPLIES_NOTE =
  'Respond in English even when the user writes in Russian: a display-layer hook translates your replies to Russian for the user, and English replies cost fewer output tokens. Do not translate code, paths, or identifiers.';

export function buildSessionStartNote(extras: ClaudeConfigExtras): string {
  const parts = [BASE_NOTE];
  // Only instruct English replies when the display layer will translate them
  // back — otherwise the user would be stuck reading English.
  if (extras.englishReplies && extras.displayBackTranslate) {
    parts.push(ENGLISH_REPLIES_NOTE);
  }
  return parts.join(' ');
}

// SessionStart hook: stdout becomes session context.
export async function runHookSessionStart(): Promise<void> {
  const extras = await loadClaudeConfigExtras();
  process.stdout.write(`${buildSessionStartNote(extras)}\n`);
}
