import { fetchWebContext } from "@/lib/openai";
import type { Intake } from "@/lib/pipeline/schemas";

export interface RunNewsContextResult {
  context: string | null;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Looks up recent, genuinely relevant industry context via OpenAI's hosted
 * web search, to help the angle/hook feel current. This is optional and
 * best-effort: not every OPENAI_MODEL supports the web_search_preview tool,
 * and a lookup failure must never block drafting. The result is treated as
 * unverified context, never as a citable fact - see prompts/angles.ts and
 * prompts/draft.ts, which require any specific claim from it to be
 * placeholdered like any other unsourced number.
 */
export async function runNewsContext(intake: Intake): Promise<RunNewsContextResult> {
  const query = `Recent (last 30 days) news or industry context relevant to this skincare/formulation topic: "${intake.core_claim}". Focus on the Indian skincare/beauty market, cosmetic regulation, or formulation science. Give at most 2 brief items, each with its source and approximate date. If nothing genuinely relevant turns up, say so plainly instead of stretching for a connection.`;

  try {
    const result = await fetchWebContext(query);
    const text = result.text.trim();
    if (!text) {
      return { context: null, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    }
    return { context: text, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  } catch {
    // Best-effort: an unsupported model, a transient error, or a rate limit
    // here should never stop a fragment from becoming a draft.
    return { context: null, tokensIn: 0, tokensOut: 0 };
  }
}
