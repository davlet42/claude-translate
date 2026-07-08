import { resolveDocForRead } from '@cursor-translate/core';

export async function runResolve(fileArg: string | undefined, args: string[]): Promise<void> {
  const json = args.includes('--json');
  const force = args.includes('--force');
  const projectIndex = args.indexOf('--project');
  const projectSlug = projectIndex >= 0 ? args[projectIndex + 1] : undefined;

  if (!fileArg) {
    throw new Error('Usage: claude-translate resolve <file> [--json] [--project slug] [--force]');
  }

  const result = await resolveDocForRead({
    sourcePath: fileArg,
    projectSlug,
    force,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('claude-translate resolve');
  console.log(`  source: ${result.sourcePath}`);
  console.log(`  read: ${result.readPath}`);
  console.log(`  action: ${result.action}`);
  console.log(`  sha256: ${result.sourceSha256}`);
  if (result.cachePath) {
    console.log(`  cache: ${result.cachePath}`);
  }
  if (result.translateModel) {
    console.log(`  model: ${result.translateModel}`);
  }
  if (result.usedFallback) {
    console.log('  fallback: true');
  }
}

// Claude Code PreToolUse hook contract: stdin carries
// { hook_event_name, tool_name, tool_input: { file_path, ... }, cwd, ... };
// stdout JSON may return hookSpecificOutput.updatedInput to rewrite the call.
export async function runResolveFromHookInput(
  hookInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;
  const filePath =
    (toolInput.file_path as string | undefined) ?? (toolInput.path as string | undefined);

  if (!filePath) {
    return {};
  }

  const cwd = typeof hookInput.cwd === 'string' ? hookInput.cwd : undefined;
  const result = await resolveDocForRead({ sourcePath: filePath, cwd });

  if (result.readPath === result.sourcePath) {
    if (result.action === 'quota_exhausted') {
      return {
        systemMessage:
          'claude-translate: translate quota exhausted; reading Russian source without translation.',
      };
    }
    return {};
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: {
        ...toolInput,
        file_path: result.readPath,
      },
      additionalContext: `claude-translate: serving the cached English translation of ${result.sourcePath} (action: ${result.action}). To modify this document, edit the original file at ${result.sourcePath}, not the cache.`,
    },
    suppressOutput: true,
  };
}
