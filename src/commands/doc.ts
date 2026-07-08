import { translateDocToGlobalCache } from '@cursor-translate/core';

export async function runDoc(args: string[]): Promise<void> {
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (!fileArg) {
    throw new Error('Usage: claude-translate doc <file> [--project slug] [--force] [--dry-run]');
  }

  const projectIdx = args.indexOf('--project');
  const projectSlug = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  const result = await translateDocToGlobalCache({
    sourcePath: fileArg,
    projectSlug,
    force,
    dryRun,
  });

  console.log('claude-translate doc');
  console.log(`  source: ${result.sourcePath}`);
  console.log(`  cache:  ${result.cachePath}`);
  console.log(`  project: ${result.projectSlug}`);
  console.log(`  provider: ${result.provider}`);
  console.log(`  model: ${result.translateModel}`);
  console.log(`  sha256: ${result.sourceSha256}`);

  if (result.skipped && result.reason === 'up_to_date') {
    console.log('  status: skipped (cache up to date, use --force to regenerate)');
    return;
  }

  if (result.skipped && result.reason === 'dry_run') {
    console.log('  status: dry-run (no API call, no write)');
    return;
  }

  console.log('  status: translated');
}
