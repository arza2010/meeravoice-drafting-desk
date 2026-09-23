import { getEnv } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { computeChecks } from "@/lib/checks";
import { reviseSchema, type ChecksResult, type Revise } from "@/lib/pipeline/schemas";
import { buildRevisePrompt } from "@/prompts/revise";

export interface RunReviseResult {
  revise: Revise;
  checks: ChecksResult;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Applies Meera's free-text edit instruction to the current draft text, then
 * re-runs the deterministic checks on the result (the spec's "re-run
 * checks and the critique stage once" - the critique re-pass is the caller's
 * job via runCritiqueLoop with loops capped at 1 from the caller side).
 */
export async function runRevise(
  currentText: string,
  instruction: string,
  groundingText: string,
): Promise<RunReviseResult> {
  const prompt = buildRevisePrompt({ currentText, instruction });
  const result = await generateStructured({
    stage: "revise",
    model: getEnv().OPENAI_MODEL,
    temperature: 0.3,
    prompt,
    schema: reviseSchema,
    schemaName: "Revise",
  });
  const checks = computeChecks(result.data.revised_text, groundingText);
  return {
    revise: result.data,
    checks,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
