import { getEnv } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { computeChecks } from "@/lib/checks";
import {
  critiqueSchema,
  type ChecksResult,
  type Critique,
  type DraftOutput,
  type Intake,
} from "@/lib/pipeline/schemas";
import { buildCritiquePrompt } from "@/prompts/critique";

const MAX_CRITIQUE_LOOPS = 2;

export interface RunCritiqueLoopResult {
  text: string;
  checks: ChecksResult;
  lastCritique: Critique;
  loops: number;
  tokensIn: number;
  tokensOut: number;
}

function checksToFlags(checks: ChecksResult): string[] {
  const flags: string[] = [];
  if (checks.char_count_status === "fail_over_ceiling") {
    flags.push(`Over the 2,800 character ceiling (${checks.char_count} chars).`);
  }
  if (checks.emoji_violations.length > 0) flags.push("Contains emoji.");
  if (checks.hashtag_violations.length > 0) flags.push("Contains a hashtag.");
  if (checks.exclamation_violations.length > 0) flags.push("Contains an exclamation mark.");
  if (checks.em_dash_violations.length > 0) flags.push("Contains an em dash.");
  if (checks.en_dash_violations.length > 0) flags.push("Contains an en dash used as a dash.");
  if (checks.bullet_violations.length > 0) flags.push("Contains a bulleted line.");
  if (checks.bold_violations.length > 0) flags.push("Contains bold markup.");
  for (const v of checks.lexicon_violations) flags.push(`Banned term: "${v.term}".`);
  for (const v of checks.spelling_violations) {
    flags.push(`American spelling "${v.american}" (use "${v.british}").`);
  }
  for (const n of checks.unsupported_numbers) {
    flags.push(`Unsupported number "${n}" - not found in the transcript or brand facts.`);
  }
  return flags;
}

/**
 * Runs the critique + revise loop: at most MAX_CRITIQUE_LOOPS passes,
 * stopping as soon as the deterministic checks pass on the revised text. If
 * checks still fail after the last loop, the draft is returned anyway with
 * every remaining violation collected into flags for Meera to see.
 */
export async function runCritiqueLoop(
  draft: DraftOutput,
  intake: Intake,
  groundingText: string,
  maxLoops: number = MAX_CRITIQUE_LOOPS,
  editInstruction?: string,
): Promise<RunCritiqueLoopResult> {
  let currentText = draft.text;
  let currentChecks = computeChecks(currentText, groundingText);
  let lastCritique: Critique | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let loops = 0;

  for (let i = 0; i < maxLoops; i++) {
    loops += 1;
    const prompt = buildCritiquePrompt({
      draft: { ...draft, text: currentText },
      checks: currentChecks,
      intake,
      editInstruction,
    });
    const result = await generateStructured({
      stage: "critique",
      model: getEnv().OPENAI_MODEL,
      temperature: 0.2,
      prompt,
      schema: critiqueSchema,
      schemaName: "Critique",
    });
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    lastCritique = result.data;
    currentText = result.data.revised_text;
    currentChecks = computeChecks(currentText, groundingText);
    if (currentChecks.passed) break;
  }

  if (!lastCritique) {
    throw new Error("Critique loop ran zero times");
  }

  return {
    text: currentText,
    checks: currentChecks,
    lastCritique,
    loops,
    tokensIn,
    tokensOut,
  };
}

export function collectDeliveryFlags(result: RunCritiqueLoopResult): string[] {
  const fromChecks = checksToFlags(result.checks);
  const fromCritique = result.lastCritique.remaining_flags;
  return [...new Set([...fromChecks, ...fromCritique])];
}
