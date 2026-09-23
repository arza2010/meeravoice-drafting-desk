import { getEnv } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { anglesSchema, type Angles, type Intake } from "@/lib/pipeline/schemas";
import { buildAnglesPrompt } from "@/prompts/angles";
import type { RecentPostSummary } from "@/prompts/types";

export interface RunAnglesResult {
  angles: Angles;
  tokensIn: number;
  tokensOut: number;
  retried: boolean;
}

export async function runAngles(
  intake: Intake,
  recentPosts: RecentPostSummary[],
  meeraFeedback: string[],
  newsContext?: string | null,
): Promise<RunAnglesResult> {
  const prompt = buildAnglesPrompt({ intake, recentPosts, meeraFeedback, newsContext });
  const result = await generateStructured({
    stage: "angles",
    model: getEnv().OPENAI_MODEL,
    temperature: 0.8,
    prompt,
    schema: anglesSchema,
    schemaName: "Angles",
  });
  return {
    angles: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    retried: result.retried,
  };
}
