import { DEFAULT_GC_ORPHAN_DAYS, gcOrphanedCaches } from '@cursor-translate/core';

// Remove caches of deleted/renamed docs. Orphans survive a grace period
// (default 30 days, `cache.gc_orphan_days`) so a git branch switch that
// temporarily hides a source does not throw away a paid translation.
export async function runCacheGc(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const daysIdx = args.indexOf('--days');
  let graceDays: number | undefined;
  if (daysIdx >= 0) {
    graceDays = Number(args[daysIdx + 1]);
    if (!Number.isFinite(graceDays) || graceDays < 0) {
      console.error('cache-gc: --days expects a non-negative number');
      process.exitCode = 1;
      return;
    }
  }

  const result = await gcOrphanedCaches({ graceDays, dryRun });
  if (result.disabled) {
    console.log('cache-gc: disabled (grace days ≤ 0)');
    return;
  }

  const prefix = dryRun ? 'cache-gc (dry-run)' : 'cache-gc';
  console.log(
    `${prefix}: scanned ${result.scanned} cache entries — orphans ${result.orphans} (newly marked ${result.marked}, in grace ${result.keptInGrace})`,
  );
  if (result.removed.length > 0) {
    console.log(`  ${dryRun ? 'would remove' : 'removed'} ${result.removed.length}:`);
    for (const rel of result.removed) {
      console.log(`    ${rel}`);
    }
  } else {
    console.log(`  nothing to remove (grace: ${graceDays ?? DEFAULT_GC_ORPHAN_DAYS} days)`);
  }
}
