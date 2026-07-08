import { backTranslateResponse, translateUserPrompt } from '@cursor-translate/core';
import { runClaudeHeadless } from '../helpers/run-claude-headless.js';

export async function runAgent(args: string[]): Promise<void> {
  const dashIndex = args.indexOf('--');
  if (dashIndex < 0) {
    throw new Error(
      'Usage: claude-translate agent [claude flags] -- "<prompt>" [--json] [--force] [--no-back-translate] [--project slug]',
    );
  }

  const claudeArgs = args.slice(0, dashIndex);
  const tailArgs = args.slice(dashIndex + 1);
  const json = tailArgs.includes('--json');
  const force = tailArgs.includes('--force');
  const noBackTranslate = tailArgs.includes('--no-back-translate');
  const projectIdx = tailArgs.indexOf('--project');
  const projectSlug = projectIdx >= 0 ? tailArgs[projectIdx + 1] : undefined;

  const promptParts = tailArgs.filter(
    (a, i) => !a.startsWith('--') && (projectIdx < 0 || i !== projectIdx + 1),
  );
  const prompt = promptParts.join(' ').trim();

  if (!prompt) {
    throw new Error('Prompt after -- is required');
  }

  const translateIn = await translateUserPrompt({
    text: prompt,
    projectSlug,
    force,
  });

  if (process.env.CLAUDE_TRANSLATE_VERBOSE === '1') {
    console.error(
      `claude-translate agent: prompt ${translateIn.skipped ? `skipped (${translateIn.reason})` : `translated via ${translateIn.modelUsed}`}`,
    );
  }

  const agentResult = runClaudeHeadless({
    args: claudeArgs,
    prompt: translateIn.text,
  });

  if (agentResult.exitCode !== 0) {
    if (agentResult.stderr.trim()) {
      console.error(agentResult.stderr.trim());
    }
    process.exitCode = agentResult.exitCode;
    return;
  }

  const agentText = agentResult.stdout.trimEnd();
  let finalText = agentText;

  if (!noBackTranslate) {
    const translateOut = await backTranslateResponse({
      text: agentText,
      projectSlug,
      force,
    });
    finalText = translateOut.text;

    if (process.env.CLAUDE_TRANSLATE_VERBOSE === '1') {
      console.error(
        `claude-translate agent: response ${translateOut.skipped ? `skipped (${translateOut.reason})` : `back-translated via ${translateOut.modelUsed}`}`,
      );
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          promptOriginal: prompt,
          promptTranslated: translateIn.text,
          promptSkipped: translateIn.skipped,
          promptReason: translateIn.reason,
          agentStdout: agentText,
          responseFinal: finalText,
          backTranslateSkipped: noBackTranslate,
        },
        null,
        2,
      ),
    );
    return;
  }

  process.stdout.write(finalText);
  if (!finalText.endsWith('\n')) {
    process.stdout.write('\n');
  }
}
