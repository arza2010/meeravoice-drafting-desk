import { getEnv } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { intakeSchema, type Intake } from "@/lib/pipeline/schemas";
import { buildIntakePrompt } from "@/prompts/intake";
import type { RecentPostSummary } from "@/prompts/types";

export interface RunIntakeResult {
  intake: Intake;
  tokensIn: number;
  tokensOut: number;
  retried: boolean;
}

export async function runIntake(
  transcripts: string[],
  recentPosts: RecentPostSummary[],
): Promise<RunIntakeResult> {
  const prompt = buildIntakePrompt({ transcripts, recentPosts });
  const result = await generateStructured({
    stage: "intake",
    model: getEnv().OPENAI_MODEL,
    temperature: 0.2,
    prompt,
    schema: intakeSchema,
    schemaName: "Intake",
  });
  return {
    intake: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    retried: result.retried,
  };
}
