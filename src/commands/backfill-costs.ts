import { backfillTranslateCosts } from '@cursor-translate/core';

export async function runBackfillCosts(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const projectIdx = args.indexOf('--project');
  const projectSlug = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

  const result = await backfillTranslateCosts({ projectSlug, dryRun });

  console.log('claude-translate backfill-costs');
  if (projectSlug) {
    console.log(`  project: ${projectSlug}`);
  }
  console.log(`  cache files scanned: ${result.scannedCacheFiles}`);
  console.log(`  backfilled: ${result.backfilled}`);
  console.log(`  skipped (already logged): ${result.skippedExisting}`);
  console.log(`  skipped (missing source/cache): ${result.skippedMissingSource}`);
  console.log(`  translate cost (est): ~${result.totalCostTokensEst} tokens`);
  console.log(`  metrics: ${result.metricsPath}`);
  if (dryRun) {
    console.log('  (dry-run — no writes)');
  }
}
