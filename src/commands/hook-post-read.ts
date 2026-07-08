import { readFile } from 'node:fs/promises';
import { resolveDocForRead } from '@cursor-translate/core';
import { loadClaudeConfigExtras } from '../helpers/load-claude-config-extras.js';
import { readStdin } from '../helpers/read-stdin.js';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/;

function stripCacheFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, '');
}

// The Read tool's response is a structured object:
//   { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
// updatedToolOutput must keep that exact shape (Claude Code validates it), so
// we clone the response and swap file.content for the English translation.
function buildUpdatedToolOutput(
  toolResponse: Record<string, unknown>,
  enBody: string,
): Record<string, unknown> {
  const file = (toolResponse.file ?? {}) as Record<string, unknown>;
  const lineCount = enBody.split('\n').length;

  return {
    ...toolResponse,
    file: {
      ...file,
      content: enBody,
      numLines: lineCount,
      startLine: 1,
      totalLines: lineCount,
    },
  };
}

// PostToolUse hook contract (matcher Read): stdin carries
// { hook_event_name: "PostToolUse", tool_name, tool_input, tool_response, cwd };
// stdout may return hookSpecificOutput.updatedToolOutput to replace the tool
// result the model sees. Active only when hooks.lazy_read_mode = content.
export async function resolvePostReadFromHookInput(
  hookInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const extras = await loadClaudeConfigExtras();
  if (extras.lazyReadMode !== 'content') {
    return {};
  }

  if (hookInput.tool_name !== undefined && hookInput.tool_name !== 'Read') {
    return {};
  }

  const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
  const filePath =
    (toolInput.file_path as string | undefined) ?? (toolInput.path as string | undefined);

  if (!filePath || !/\.(md|mdx)$/i.test(filePath)) {
    return {};
  }

  const toolResponse = hookInput.tool_response ?? hookInput.tool_output;
  if (typeof toolResponse !== 'object' || toolResponse === null) {
    // Unknown response shape — fail open rather than risk a rejected replacement.
    return {};
  }

  const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : undefined;
  const result = await resolveDocForRead({ sourcePath: filePath, cwd });

  if (result.readPath === result.sourcePath) {
    if (result.action === 'quota_exhausted') {
      return {
        systemMessage:
          'claude-translate: translate quota exhausted; keeping the Russian Read result as-is.',
      };
    }
    if (result.action === 'lazy_deferred' && result.userHint) {
      return {
        systemMessage: result.userHint,
      };
    }
    return {};
  }

  const cacheRaw = await readFile(result.readPath, 'utf8');
  const body = stripCacheFrontmatter(cacheRaw);

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: buildUpdatedToolOutput(toolResponse as Record<string, unknown>, body),
      additionalContext: `claude-translate: this Read result is the cached English translation of ${result.sourcePath} (action: ${result.action}). Line numbers refer to the translation, not the Russian original. To modify the document, edit the original file at ${result.sourcePath}.`,
    },
  };
}

export async function runHookPostRead(): Promise<void> {
  let output: Record<string, unknown> = {};

  try {
    const raw = await readStdin();
    const input = JSON.parse(raw) as Record<string, unknown>;
    output = await resolvePostReadFromHookInput(input);
  } catch {
    // Fail open: keep the original tool output.
    output = {};
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}
