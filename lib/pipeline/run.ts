import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { drafts, fragments, type Draft } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { loadSkillFiles } from "@/lib/skill";
import { extractPlaceholders } from "@/lib/checks/numbers";
import { sendMessage } from "@/lib/telegram/api";
import { draftActionKeyboard } from "@/lib/telegram/keyboards";
import { runIntake } from "@/lib/pipeline/intake";
import { runNewsContext } from "@/lib/pipeline/news";
import { runAngles } from "@/lib/pipeline/angles";
import { runDraft } from "@/lib/pipeline/draft";
import { collectDeliveryFlags, runCritiqueLoop } from "@/lib/pipeline/critique";
import { getRecentApprovedPosts, getRecentRejectReasons, recordStageRun } from "@/lib/pipeline/context";
import type { Angles, DraftOutput, Intake } from "@/lib/pipeline/schemas";

export type StartPipelineResult =
  | { kind: "not_draftable"; missingInfo: string[] }
  | { kind: "delivered"; draftId: string };

export function groundingTextFor(transcripts: string[]): string {
  const brandFacts = loadSkillFiles().brandFacts;
  return `${transcripts.join("\n\n")}\n\n${brandFacts}`;
}

export async function groundingTextForDraft(draft: Draft): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(fragments).where(inArray(fragments.id, draft.fragmentIds));
  return groundingTextFor(rows.map((f) => f.transcript));
}

/**
 * Starts a brand-new pipeline run for one or more fragments: intake, and -
 * if draftable - creates the draft row and continues through delivery. This
 * is the entry point for both the automatic single-fragment pipeline and the
 * manual /draft [n] command.
 */
export async function startPipelineForFragments(fragmentIds: string[]): Promise<StartPipelineResult> {
  const db = getDb();
  const rows = await db.select().from(fragments).where(inArray(fragments.id, fragmentIds));
  const ordered = fragmentIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is (typeof rows)[number] => Boolean(r));
  const transcripts = ordered.map((f) => f.transcript);

  const recentPosts = await getRecentApprovedPosts();
  const t0 = Date.now();
  const intakeResult = await runIntake(transcripts, recentPosts);
  await recordStageRun({
    fragmentId: fragmentIds.length === 1 ? fragmentIds[0] : null,
    stage: "intake",
    model: getEnv().OPENAI_MODEL,
    tokensIn: intakeResult.tokensIn,
    tokensOut: intakeResult.tokensOut,
    latencyMs: Date.now() - t0,
    retried: intakeResult.retried,
  });

  if (fragmentIds.length === 1 && fragmentIds[0]) {
    await db
      .update(fragments)
      .set({ intakeJson: intakeResult.intake, draftable: intakeResult.intake.draftable })
      .where(eq(fragments.id, fragmentIds[0]));
  }

  if (!intakeResult.intake.draftable) {
    return { kind: "not_draftable", missingInfo: intakeResult.intake.missing_info };
  }

  // Triage is a visible step either way: the reject path already tells
  // Meera why via "not_draftable" above. This is the matching acknowledgment
  // for the pass path, so drafting doesn't happen silently.
  await sendMessage(
    getEnv().TELEGRAM_CHAT_ID,
    `Triage: worth a post (${intakeResult.intake.substance_score}/10) - drafting now...\n\n${intakeResult.intake.core_claim}`,
  );

  const [draftRow] = await db
    .insert(drafts)
    .values({
      fragmentIds,
      intakeJson: intakeResult.intake,
      tokensIn: intakeResult.tokensIn,
      tokensOut: intakeResult.tokensOut,
      stage: "intake",
    })
    .returning();
  if (!draftRow) throw new Error("Failed to create draft row");

  await db
    .update(fragments)
    .set({ usedInDraftId: draftRow.id })
    .where(inArray(fragments.id, fragmentIds));

  await continuePipeline(draftRow.id, transcripts);
  return { kind: "delivered", draftId: draftRow.id };
}

/**
 * Resumes a draft's pipeline from its persisted `stage`. Safe to call again
 * on a draft that already reached "delivered" (it's a no-op then) - this is
 * the resumability contract: a crash between any two stages loses at most
 * the in-flight LLM call, never the stages already persisted.
 */
export async function continuePipeline(draftId: string, transcriptsHint?: string[]): Promise<void> {
  const db = getDb();
  const model = getEnv().OPENAI_MODEL;

  let [draftRow] = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  if (!draftRow) throw new Error(`Draft ${draftId} not found`);
  if (draftRow.stage === "delivered") return;

  const transcripts =
    transcriptsHint ??
    (
      await db
        .select()
        .from(fragments)
        .where(inArray(fragments.id, draftRow.fragmentIds))
    ).map((f) => f.transcript);
  const groundingText = groundingTextFor(transcripts);
  const intake = draftRow.intakeJson as Intake;

  if (draftRow.stage === "intake") {
    const t0News = Date.now();
    const newsResult = await runNewsContext(intake);
    if (newsResult.tokensIn > 0 || newsResult.tokensOut > 0) {
      await recordStageRun({
        draftId,
        stage: "news",
        model,
        tokensIn: newsResult.tokensIn,
        tokensOut: newsResult.tokensOut,
        latencyMs: Date.now() - t0News,
        retried: false,
      });
    }

    const recentPosts = await getRecentApprovedPosts();
    const feedback = await getRecentRejectReasons();
    const t0 = Date.now();
    const anglesResult = await runAngles(intake, recentPosts, feedback, newsResult.context);
    await recordStageRun({
      draftId,
      stage: "angles",
      model,
      tokensIn: anglesResult.tokensIn,
      tokensOut: anglesResult.tokensOut,
      latencyMs: Date.now() - t0,
      retried: anglesResult.retried,
    });
    const selected = anglesResult.angles.angles.find((a) => a.id === anglesResult.angles.selected);
    [draftRow] = await db
      .update(drafts)
      .set({
        newsContext: newsResult.context,
        anglesJson: anglesResult.angles,
        selectedAngle: anglesResult.angles.selected,
        pillar: selected?.pillar ?? null,
        stage: "angles",
        tokensIn: draftRow.tokensIn + newsResult.tokensIn + anglesResult.tokensIn,
        tokensOut: draftRow.tokensOut + newsResult.tokensOut + anglesResult.tokensOut,
      })
      .where(eq(drafts.id, draftId))
      .returning();
    if (!draftRow) throw new Error(`Draft ${draftId} vanished after angles update`);
  }

  if (draftRow.stage === "angles") {
    const angles = draftRow.anglesJson as Angles;
    const selected = angles.angles.find((a) => a.id === angles.selected);
    if (!selected) throw new Error(`Draft ${draftId} has no valid selected angle`);
    const t0 = Date.now();
    const draftResult = await runDraft(intake, selected, draftRow.newsContext);
    await recordStageRun({
      draftId,
      stage: "draft",
      model,
      tokensIn: draftResult.tokensIn,
      tokensOut: draftResult.tokensOut,
      latencyMs: Date.now() - t0,
      retried: draftResult.retried,
    });
    [draftRow] = await db
      .update(drafts)
      .set({
        planJson: draftResult.draft.plan,
        factsUsedJson: draftResult.draft.facts_used,
        text: draftResult.draft.text,
        stage: "draft",
        tokensIn: draftRow.tokensIn + draftResult.tokensIn,
        tokensOut: draftRow.tokensOut + draftResult.tokensOut,
      })
      .where(eq(drafts.id, draftId))
      .returning();
    if (!draftRow) throw new Error(`Draft ${draftId} vanished after draft update`);
  }

  if (draftRow.stage === "draft") {
    const draftOutput: DraftOutput = {
      plan: draftRow.planJson as DraftOutput["plan"],
      text: draftRow.text as string,
      facts_used: (draftRow.factsUsedJson as DraftOutput["facts_used"] | null) ?? [],
      placeholders: extractPlaceholders(draftRow.text as string),
    };
    const t0 = Date.now();
    const critiqueResult = await runCritiqueLoop(draftOutput, intake, groundingText);
    await recordStageRun({
      draftId,
      stage: "critique",
      model,
      tokensIn: critiqueResult.tokensIn,
      tokensOut: critiqueResult.tokensOut,
      latencyMs: Date.now() - t0,
      retried: false,
    });
    [draftRow] = await db
      .update(drafts)
      .set({
        text: critiqueResult.text,
        checksJson: critiqueResult.checks,
        critiqueJson: critiqueResult.lastCritique,
        stage: "critique",
        tokensIn: draftRow.tokensIn + critiqueResult.tokensIn,
        tokensOut: draftRow.tokensOut + critiqueResult.tokensOut,
      })
      .where(eq(drafts.id, draftId))
      .returning();
    if (!draftRow) throw new Error(`Draft ${draftId} vanished after critique update`);
  }

  if (draftRow.stage === "critique") {
    await deliverDraft(draftRow);
  }
}

function formatDraftMessage(draft: Draft): string {
  const flags = draft.critiqueJson
    ? collectDeliveryFlagsFromPersisted(draft)
    : [];
  const placeholders = extractPlaceholders(draft.text ?? "");
  const charCount = (draft.text ?? "").trim().length;
  const flagNote = flags.length > 0 ? ` · ${flags.length} flag${flags.length === 1 ? "" : "s"}` : "";

  const parts = [`Draft ${draft.seq} · ${draft.pillar ?? "Unassigned"} · ${charCount} chars${flagNote}`];

  if (flags.length > 0) {
    parts.push(`Flags from automatic checks (please review):\n${flags.map((f) => `- ${f}`).join("\n")}`);
  }

  parts.push(draft.text ?? "");

  if (placeholders.length > 0) {
    parts.push(`Before posting, confirm:\n${placeholders.map((p) => `- ${p}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

function collectDeliveryFlagsFromPersisted(draft: Draft): string[] {
  const checks = draft.checksJson as import("@/lib/pipeline/schemas").ChecksResult | null;
  const critique = draft.critiqueJson as import("@/lib/pipeline/schemas").Critique | null;
  if (!checks || !critique) return [];
  return collectDeliveryFlags({
    text: draft.text ?? "",
    checks,
    lastCritique: critique,
    loops: 0,
    tokensIn: 0,
    tokensOut: 0,
  });
}

export async function deliverDraft(draft: Draft): Promise<void> {
  const db = getDb();
  const message = formatDraftMessage(draft);
  const sent = await sendMessage(getEnv().TELEGRAM_CHAT_ID, message, {
    replyMarkup: draftActionKeyboard(draft.id),
  });
  await db
    .update(drafts)
    .set({ telegramMessageId: sent.message_id, stage: "delivered" })
    .where(eq(drafts.id, draft.id));
}
