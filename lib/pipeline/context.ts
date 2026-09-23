import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { drafts, stageRuns } from "@/lib/db/schema";
import type { Angles } from "@/lib/pipeline/schemas";
import type { RecentPostSummary } from "@/prompts/types";

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? text;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

export async function getRecentApprovedPosts(limit = 10): Promise<RecentPostSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(drafts)
    .where(eq(drafts.status, "approved"))
    .orderBy(desc(drafts.decidedAt))
    .limit(limit);

  return rows
    .filter((r) => r.text)
    .map((r) => {
      const angles = r.anglesJson as Angles | null;
      const selectedAngle = angles?.angles.find((a) => a.id === angles.selected);
      return {
        pillar: r.pillar ?? selectedAngle?.pillar ?? "Formulation Literacy",
        hookType: selectedAngle?.hook_type,
        firstLine: firstLine(r.text as string),
      };
    });
}

export async function getRecentRejectReasons(limit = 5): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(drafts)
    .where(eq(drafts.status, "rejected"))
    .orderBy(desc(drafts.decidedAt))
    .limit(limit);
  return rows
    .map((r) => r.rejectReason)
    .filter((r): r is string => Boolean(r && r.trim().length > 0));
}

export async function recordStageRun(input: {
  fragmentId?: string | null;
  draftId?: string | null;
  stage: "intake" | "angles" | "draft" | "critique" | "revise";
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  retried: boolean;
}): Promise<void> {
  const db = getDb();
  await db.insert(stageRuns).values({
    fragmentId: input.fragmentId ?? null,
    draftId: input.draftId ?? null,
    stage: input.stage,
    model: input.model,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    latencyMs: input.latencyMs,
    retried: input.retried,
  });
}

