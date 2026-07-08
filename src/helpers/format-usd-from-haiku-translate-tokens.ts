import { HAIKU_TRANSLATE_PRICING } from '../constants/haiku-translate-pricing.constant.js';

export function formatUsdFromHaikuTranslateTokens(tokens: number): string {
  const { inputUsdPerMillion, outputUsdPerMillion, inputTokenShare, outputTokenShare } =
    HAIKU_TRANSLATE_PRICING;
  const inputRate = inputUsdPerMillion / 1_000_000;
  const outputRate = outputUsdPerMillion / 1_000_000;
  const usd = tokens * inputTokenShare * inputRate + tokens * outputTokenShare * outputRate;
  return usd.toFixed(2);
}
