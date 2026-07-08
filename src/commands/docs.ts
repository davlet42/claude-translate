import { translateProjectDocsToGlobalCache } from '@cursor-translate/core';

function parseFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || !args[idx + 1]) {
    return undefined;
  }
  return args[idx + 1];
}

export async function runDocs(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith('--'));
  const scopePath = positional[0];

  const minCyrillicRatioRaw = parseFlagValue(args, '--min-cyrillic-ratio');
  const minCharsRaw = parseFlagValue(args, '--min-chars');
  const projectSlug = parseFlagValue(args, '--project');

  const result = await translateProjectDocsToGlobalCache({
    scopePath,
    projectSlug,
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run'),
    includeGitignored: args.includes('--include-gitignored'),
    minCyrillicRatio: minCyrillicRatioRaw ? Number(minCyrillicRatioRaw) : undefined,
    minChars: minCharsRaw ? Number(minCharsRaw) : undefined,
  });

  console.log('claude-translate docs');
  console.log(`  project: ${result.projectSlug}`);
  console.log(`  root: ${result.projectRoot}`);
  console.log(`  scan: ${args.includes('--include-gitignored') ? 'all (incl. gitignored)' : 'tracked (git ls-files)'}`);
  if (scopePath) {
    console.log(`  scope: ${scopePath}`);
  }
  console.log(`  with_cyrillic: ${result.withCyrillic}`);
  console.log(`  translated: ${result.translated}`);
  console.log(`  up_to_date: ${result.skippedUpToDate}`);

  if (args.includes('--dry-run')) {
    console.log(`  planned: ${result.planned} file(s) would be processed`);
  }

  if (!result.candidates.length) {
    console.log('  (no markdown files with cyrillic found)');
    return;
  }

  console.log('');
  console.log('  files:');
  for (const item of result.items) {
    const status = item.skipped
      ? item.reason === 'up_to_date'
        ? 'skip'
        : 'dry-run'
      : 'translated';
    console.log(`    [${status}] ${item.sourcePath}`);
    if (!args.includes('--dry-run') || item.skipped) {
      console.log(`            → ${item.cachePath}`);
    }
  }
}
