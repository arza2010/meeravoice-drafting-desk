/**
 * USD per 1M tokens, maintained by hand - OpenAI doesn't expose pricing via
 * API. Update this when OPENAI_MODEL points at a model that isn't listed
 * here, or when pricing changes. Not wired into any UI (there isn't one);
 * it's a helper for turning stage_runs token counts into a cost estimate
 * yourself - see the README's "Cost per draft" section.
 */
export const MODEL_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
};

/** Returns null for an unlisted model rather than guessing a fabricated cost. */
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const pricing = MODEL_PRICING_PER_MILLION[model];
  if (!pricing) return null;
  return (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
}
