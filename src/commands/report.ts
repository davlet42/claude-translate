import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  estimateBreakEvenReads,
  resolveBySourceKey,
  resolveDocTranslateCostBucket,
  resolveMetricsPathFromEnv,
} from '../helpers/report-helpers.js';
import { resolveClaudeTranslateHome } from '../claude-env.js';
import { HAIKU_TRANSLATE_PRICING } from '../constants/haiku-translate-pricing.constant.js';
import { formatUsdFromHaikuTranslateTokens } from '../helpers/format-usd-from-haiku-translate-tokens.js';

const DEFAULT_METRICS_PATH = join(resolveClaudeTranslateHome(), 'metrics.jsonl');

const REALIZED_SOURCES = new Set(['doc_cache_served', 'prompt_translated']);
const COST_SOURCES = new Set(['doc_translate_cost', 'prompt_translated', 'response_back_translated']);
const OPPORTUNITY_SOURCES = new Set([
  'user_prompt',
  'agent_response',
  'file_read',
  'subagent_task',
  'subagent_summary',
]);

export interface MetricsEntry {
  ts: string;
  source?: string;
  skipped?: boolean;
  reason?: string;
  ru_tokens_est: number;
  en_tokens_est: number;
  saved_tokens_est: number;
  translate_cost_tokens_est?: number;
  text_chars?: number;
  prompt_chars?: number;
  cyrillic_ratio?: number;
  file_path?: string | null;
  cache_path?: string | null;
  project_slug?: string | null;
  action?: string | null;
  subagent_type?: string | null;
  tool_call_count?: number | null;
  message_count?: number | null;
  duration_ms?: number | null;
}

export interface ReportResult {
  days: number;
  totalEvents: number;
  bySource: Record<
    string,
    {
      events: number;
      savedTokensEst: number;
      translateCostTokensEst: number;
      chars: number;
      subagentRuns?: number;
      toolCalls?: number;
    }
  >;
  totalSavedTokensEst: number;
  realizedSavingsTokensEst: number;
  translateCostTokensEst: number;
  netDocRoiTokensEst: number;
  opportunityTokensEst: number;
  promptSavingsTokensEst: number;
  promptTranslateCostTokensEst: number;
  docSavingsTokensEst: number;
  docCacheServedEvents: number;
  docWarmupCostTokensEst: number;
  docIncrementalCostTokensEst: number;
  operationalSavingsTokensEst: number;
  operationalTranslateCostTokensEst: number;
  operationalNetRoiTokensEst: number;
  metricsPath: string;
}

function emptyReportResult(days: number, metricsPath: string): ReportResult {
  return {
    days,
    totalEvents: 0,
    bySource: {},
    totalSavedTokensEst: 0,
    realizedSavingsTokensEst: 0,
    translateCostTokensEst: 0,
    netDocRoiTokensEst: 0,
    opportunityTokensEst: 0,
    promptSavingsTokensEst: 0,
    promptTranslateCostTokensEst: 0,
    docSavingsTokensEst: 0,
    docCacheServedEvents: 0,
    docWarmupCostTokensEst: 0,
    docIncrementalCostTokensEst: 0,
    operationalSavingsTokensEst: 0,
    operationalTranslateCostTokensEst: 0,
    operationalNetRoiTokensEst: 0,
    metricsPath,
  };
}

function parseDays(args: string[]): number {
  const idx = args.indexOf('--days');
  if (idx === -1 || !args[idx + 1]) {
    return 7;
  }
  const n = Number(args[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function normalizeSource(entry: MetricsEntry): string {
  if (entry.source) {
    return entry.source;
  }
  return 'user_prompt';
}

export async function runReport(args: string[]): Promise<ReportResult> {
  const days = parseDays(args);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const metricsPath = resolveMetricsPathFromEnv(DEFAULT_METRICS_PATH);

  let raw = '';
  try {
    raw = await readFile(metricsPath, 'utf8');
  } catch {
    return emptyReportResult(days, metricsPath);
  }

  const bySource: Record<
    string,
    {
      events: number;
      savedTokensEst: number;
      translateCostTokensEst: number;
      chars: number;
      subagentRuns: number;
      toolCalls: number;
    }
  > = {};
  let totalEvents = 0;
  let totalSavedTokensEst = 0;
  let realizedSavingsTokensEst = 0;
  let translateCostTokensEst = 0;
  let opportunityTokensEst = 0;
  let promptSavingsTokensEst = 0;
  let promptTranslateCostTokensEst = 0;
  let docSavingsTokensEst = 0;
  let docCacheServedEvents = 0;
  let docWarmupCostTokensEst = 0;
  let docIncrementalCostTokensEst = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let entry: MetricsEntry;
    try {
      entry = JSON.parse(line) as MetricsEntry;
    } catch {
      continue;
    }

    const ts = Date.parse(entry.ts);
    if (Number.isFinite(ts) && ts < cutoff) {
      continue;
    }

    const source = normalizeSource(entry);
    const bySourceKey = resolveBySourceKey(entry, source);
    if (!bySource[bySourceKey]) {
      bySource[bySourceKey] = {
        events: 0,
        savedTokensEst: 0,
        translateCostTokensEst: 0,
        chars: 0,
        subagentRuns: 0,
        toolCalls: 0,
      };
    }

    const saved = entry.saved_tokens_est ?? 0;
    const cost = entry.translate_cost_tokens_est ?? 0;

    bySource[bySourceKey].events += 1;
    bySource[bySourceKey].savedTokensEst += saved;
    bySource[bySourceKey].translateCostTokensEst += cost;
    bySource[bySourceKey].chars += entry.text_chars ?? entry.prompt_chars ?? 0;
    if (source === 'subagent_summary') {
      bySource[bySourceKey].subagentRuns += 1;
      bySource[bySourceKey].toolCalls += entry.tool_call_count ?? 0;
    }

    totalEvents += 1;
    totalSavedTokensEst += saved;
    translateCostTokensEst += cost;

    if (source === 'doc_cache_served') {
      docSavingsTokensEst += saved;
      docCacheServedEvents += 1;
    }

    if (source === 'doc_translate_cost') {
      if (resolveDocTranslateCostBucket(entry) === 'warmup') {
        docWarmupCostTokensEst += cost;
      } else {
        docIncrementalCostTokensEst += cost;
      }
    }

    if (REALIZED_SOURCES.has(source)) {
      realizedSavingsTokensEst += saved;
      if (source === 'prompt_translated') {
        promptSavingsTokensEst += saved;
      }
    } else if (OPPORTUNITY_SOURCES.has(source)) {
      opportunityTokensEst += saved;
    }

    if (COST_SOURCES.has(source)) {
      if (source === 'prompt_translated' || source === 'response_back_translated') {
        promptTranslateCostTokensEst += cost;
      }
    }
  }

  const operationalTranslateCostTokensEst =
    docIncrementalCostTokensEst + promptTranslateCostTokensEst;
  const operationalSavingsTokensEst = realizedSavingsTokensEst;
  const operationalNetRoiTokensEst =
    operationalSavingsTokensEst - operationalTranslateCostTokensEst;
  const netDocRoiTokensEst = realizedSavingsTokensEst - translateCostTokensEst;

  return {
    days,
    totalEvents,
    bySource,
    totalSavedTokensEst,
    realizedSavingsTokensEst,
    translateCostTokensEst,
    netDocRoiTokensEst,
    opportunityTokensEst,
    promptSavingsTokensEst,
    promptTranslateCostTokensEst,
    docSavingsTokensEst,
    docCacheServedEvents,
    docWarmupCostTokensEst,
    docIncrementalCostTokensEst,
    operationalSavingsTokensEst,
    operationalTranslateCostTokensEst,
    operationalNetRoiTokensEst,
    metricsPath,
  };
}

function formatUsdFromMainAgentTokens(tokens: number): string {
  const blendedRate = 3 / 1_000_000;
  return (tokens * blendedRate).toFixed(2);
}

function formatSignedTokens(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

export function formatReport(result: ReportResult): string {
  const operationalSavingsUsd = formatUsdFromMainAgentTokens(result.operationalSavingsTokensEst);
  const operationalSpendUsd = formatUsdFromHaikuTranslateTokens(
    result.operationalTranslateCostTokensEst,
  );
  const operationalNetUsd = (
    Number(operationalSavingsUsd) - Number(operationalSpendUsd)
  ).toFixed(2);
  const warmupSpendUsd = formatUsdFromHaikuTranslateTokens(result.docWarmupCostTokensEst);
  const breakEvenReads = estimateBreakEvenReads(
    result.docWarmupCostTokensEst,
    result.docSavingsTokensEst,
    result.docCacheServedEvents,
  );

  const lines: string[] = [
    `claude-translate report (last ${result.days} days)`,
    `  metrics: ${result.metricsPath}`,
    `  events: ${result.totalEvents}`,
    '',
    '  ROI operational (reads + prompts — excludes batch warmup):',
    `    doc cache served (lazy read / MCP resolve_doc): ~${result.docSavingsTokensEst} tokens saved (${result.docCacheServedEvents} reads)`,
    `    prompt translated RU→EN (CLI + MCP): ~${result.promptSavingsTokensEst} tokens saved`,
    `    incremental doc translate: ~${result.docIncrementalCostTokensEst} tokens`,
    `    prompt/back-translate cost: ~${result.promptTranslateCostTokensEst} tokens`,
    `    net operational ROI: ~${formatSignedTokens(result.operationalNetRoiTokensEst)} tokens`,
    `    est. main-agent context saved: ~$${operationalSavingsUsd} (@ ~$3/1M)`,
    `    est. incremental translate spend: ~$${operationalSpendUsd} (${HAIKU_TRANSLATE_PRICING.rateLabel})`,
    `    est. net operational USD: ~$${operationalNetUsd} (saved − incremental spend)`,
    '',
    '  ROI investment (one-time doc cache warmup):',
    `    batch docs warmup cost: ~${result.docWarmupCostTokensEst} tokens (~$${warmupSpendUsd} ${HAIKU_TRANSLATE_PRICING.rateLabel})`,
  ];

  if (breakEvenReads !== null) {
    lines.push(
      `    break-even reads (warmup ÷ avg savings/read): ~${breakEvenReads} more doc_cache_served events`,
    );
  } else if (result.docWarmupCostTokensEst > 0) {
    lines.push('    break-even reads: n/a (no doc_cache_served events in window yet)');
  }

  lines.push(
    '',
    '  ROI combined (legacy — includes warmup in spend):',
    `    total context saved: ~${result.realizedSavingsTokensEst} tokens`,
    `    total translate spend: ~${result.translateCostTokensEst} tokens`,
    `    net ROI: ~${formatSignedTokens(result.netDocRoiTokensEst)} tokens`,
    '',
    '  opportunity (IDE hooks — audit only):',
    `    potential if RU→EN applied in IDE: ~${result.opportunityTokensEst} tokens`,
    '',
    '  by source:',
  );

  const sources = Object.keys(result.bySource).sort();
  if (!sources.length) {
    lines.push('    (no events yet)');
    return lines.join('\n');
  }

  for (const source of sources) {
    const row = result.bySource[source];
    let line = `    ${source}: ${row.events} events`;
    if (row.savedTokensEst > 0) {
      line += `, ~${row.savedTokensEst} saved tokens`;
    }
    if (row.translateCostTokensEst > 0) {
      line += `, ~${row.translateCostTokensEst} translate cost tokens`;
    }
    line += `, ${row.chars} chars`;
    if (source === 'subagent_summary' && (row.subagentRuns ?? 0) > 0) {
      line += `, ${row.subagentRuns} runs, ${row.toolCalls ?? 0} tool calls`;
    }
    lines.push(line);
  }

  lines.push('');
  lines.push('  notes:');
  lines.push('    - doc_cache_served = EN cache served (lazy Read hook or MCP resolve_doc)');
  lines.push('    - prompt_translated = RU→EN via CLI prompt/agent or MCP translate tool');
  lines.push('    - doc_translate_cost (warmup) = batch `claude-translate docs` — one-time cache investment');
  lines.push('    - doc_translate_cost (incremental) = on-demand translate (cache miss/stale)');
  lines.push('    - user_prompt/agent_response = IDE audit only (not auto-translated in IDE)');
  lines.push('    - operational ROI excludes warmup; use break-even reads to judge cache payback');
  lines.push(
    `    - translate spend USD uses ${HAIKU_TRANSLATE_PRICING.rateLabel} (default claude-haiku-4-5)`,
  );

  return lines.join('\n');
}
