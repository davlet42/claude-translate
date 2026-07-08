import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { formatUsdFromHaikuTranslateTokens } from '../dist/helpers/format-usd-from-haiku-translate-tokens.js';
import { runReport, formatReport } from '../dist/commands/report.js';

describe('formatUsdFromHaikuTranslateTokens', () => {
  it('uses haiku list rates ($1 in / $5 out per 1M, 70/30 blend)', () => {
    assert.equal(formatUsdFromHaikuTranslateTokens(1_000_000), '2.20');
    assert.equal(formatUsdFromHaikuTranslateTokens(0), '0.00');
  });
});

describe('runReport', () => {
  let tempDir = '';
  let metricsPath = '';
  const originalMetricsEnv = process.env.CLAUDE_TRANSLATE_METRICS_PATH;

  after(() => {
    if (originalMetricsEnv === undefined) {
      delete process.env.CLAUDE_TRANSLATE_METRICS_PATH;
    } else {
      process.env.CLAUDE_TRANSLATE_METRICS_PATH = originalMetricsEnv;
    }
  });

  it('labels translate spend with haiku rates', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-translate-report-'));
    metricsPath = join(tempDir, 'metrics.jsonl');
    const now = new Date().toISOString();

    writeFileSync(
      metricsPath,
      `${[
        JSON.stringify({
          ts: now,
          source: 'doc_translate_cost',
          reason: 'warmup_translate',
          translate_cost_tokens_est: 1_000_000,
          saved_tokens_est: 0,
        }),
      ].join('\n')}\n`,
      'utf8',
    );
    process.env.CLAUDE_TRANSLATE_METRICS_PATH = metricsPath;

    const result = await runReport(['--days', '7']);
    const formatted = formatReport(result);

    assert.match(formatted, /@ haiku rates/);
    assert.match(formatted, /\$2\.20/);
    assert.doesNotMatch(formatted, /nano rates/);
  });
});
