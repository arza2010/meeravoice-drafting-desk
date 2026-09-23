import { getEnv } from "@/lib/env";
import { generateStructured } from "@/lib/openai";
import { draftOutputSchema, type Angle, type DraftOutput, type Intake } from "@/lib/pipeline/schemas";
import { buildDraftPrompt } from "@/prompts/draft";

export interface RunDraftResult {
  draft: DraftOutput;
  tokensIn: number;
  tokensOut: number;
  retried: boolean;
}

export async function runDraft(intake: Intake, angle: Angle): Promise<RunDraftResult> {
  const prompt = buildDraftPrompt({ intake, angle });
  const result = await generateStructured({
    stage: "draft",
    model: getEnv().OPENAI_MODEL,
    temperature: 0.5,
    prompt,
    schema: draftOutputSchema,
    schemaName: "DraftOutput",
  });
  return {
    draft: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    retried: result.retried,
  };
}
