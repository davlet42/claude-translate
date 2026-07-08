import type { MetricsEntry } from '../commands/report.js';

export function resolveDocTranslateCostBucket(entry: MetricsEntry): 'warmup' | 'incremental' {
  if (entry.reason === 'warmup_translate') {
    return 'warmup';
  }
  return 'incremental';
}

export function resolveBySourceKey(entry: MetricsEntry, source: string): string {
  if (source === 'doc_translate_cost') {
    return entry.reason === 'warmup_translate'
      ? 'doc_translate_cost (warmup)'
      : 'doc_translate_cost (incremental)';
  }
  return source;
}

export function estimateBreakEvenReads(
  warmupCostTokens: number,
  docSavings: number,
  reads: number,
): number | null {
  if (warmupCostTokens <= 0) {
    return null;
  }
  if (reads <= 0 || docSavings <= 0) {
    return null;
  }
  const avgSavingsPerRead = docSavings / reads;
  if (avgSavingsPerRead <= 0) {
    return null;
  }
  return Math.ceil(warmupCostTokens / avgSavingsPerRead);
}

export function resolveMetricsPathFromEnv(defaultPath: string): string {
  return process.env.CLAUDE_TRANSLATE_METRICS_PATH?.trim() || process.env.CURSOR_TRANSLATE_METRICS_PATH?.trim() || defaultPath;
}
