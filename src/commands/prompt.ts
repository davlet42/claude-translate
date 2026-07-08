import { translateUserPrompt } from '@cursor-translate/core';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readPromptText(args: string[]): Promise<string> {
  if (args.includes('--stdin')) {
    return readStdin();
  }

  const textArg = args.find((a) => !a.startsWith('--'));
  if (!textArg) {
    throw new Error('Usage: claude-translate prompt "<text>" [--json] [--force] [--project slug] [--stdin]');
  }

  return textArg;
}

export async function runPrompt(args: string[]): Promise<void> {
  const text = (await readPromptText(args)).trim();
  if (!text) {
    throw new Error('Prompt text is empty');
  }

  const projectIdx = args.indexOf('--project');
  const projectSlug = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const force = args.includes('--force');
  const json = args.includes('--json');

  const result = await translateUserPrompt({
    text,
    projectSlug,
    force,
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          text: result.text,
          skipped: result.skipped,
          reason: result.reason,
          originalText: result.originalText,
          modelUsed: result.modelUsed ?? null,
          usedFallback: result.usedFallback ?? false,
          cyrillicRatio: result.cyrillicRatio,
          savedTokensEst: result.savedTokensEst,
          projectSlug: result.projectSlug,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!result.skipped && result.reason === 'translated' && process.env.CLAUDE_TRANSLATE_VERBOSE === '1') {
    console.error(
      `claude-translate prompt: translated (${result.modelUsed}, ~${result.savedTokensEst} tokens saved est.)`,
    );
  }

  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) {
    process.stdout.write('\n');
  }
}
