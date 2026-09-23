import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { drafts, fragments, type Draft } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { editMessageReplyMarkup, sendMessage } from "@/lib/telegram/api";
import { continuePipeline, deliverDraft, groundingTextForDraft } from "@/lib/pipeline/run";
import { runRevise } from "@/lib/pipeline/revise";
import { runCritiqueLoop } from "@/lib/pipeline/critique";
import { recordStageRun } from "@/lib/pipeline/context";
import type { DraftOutput, Intake } from "@/lib/pipeline/schemas";

async function stripKeyboard(draft: Draft): Promise<void> {
  if (!draft.telegramMessageId) return;
  try {
    await editMessageReplyMarkup(getEnv().TELEGRAM_CHAT_ID, draft.telegramMessageId, {
      inline_keyboard: [],
    });
  } catch {
    // Best-effort - an already-edited or too-old message shouldn't block the action.
  }
}

export async function getDraftOrThrow(draftId: string): Promise<Draft> {
  const db = getDb();
  const [draft] = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  if (!draft) throw new Error(`Draft ${draftId} not found`);
  return draft;
}

/** Approving never touches LinkedIn - it marks the draft decided and hands Meera a clean copy. */
export async function approveDraft(draftId: string): Promise<void> {
  const db = getDb();
  const draft = await getDraftOrThrow(draftId);
  await db
    .update(drafts)
    .set({ status: "approved", decidedAt: new Date() })
    .where(eq(drafts.id, draftId));
  await stripKeyboard(draft);
  await sendMessage(getEnv().TELEGRAM_CHAT_ID, `Approved. Here's the clean copy:\n\n${draft.text ?? ""}`);
}

export async function finalizeReject(draftId: string, reason: string | null): Promise<void> {
  const db = getDb();
  const draft = await getDraftOrThrow(draftId);
  await db
    .update(drafts)
    .set({ status: "rejected", rejectReason: reason, decidedAt: new Date() })
    .where(eq(drafts.id, draftId));
  await stripKeyboard(draft);
  await sendMessage(getEnv().TELEGRAM_CHAT_ID, "Rejected. That reason will inform the next draft.");
}

export async function applyEditInstruction(draftId: string, instruction: string): Promise<void> {
  const draft = await getDraftOrThrow(draftId);
  if (!draft.text) throw new Error(`Draft ${draftId} has no text to edit`);
  const groundingText = await groundingTextForDraft(draft);
  const model = getEnv().OPENAI_MODEL;

  const t0 = Date.now();
  const reviseResult = await runRevise(draft.text, instruction, groundingText);
  await recordStageRun({
    draftId,
    stage: "revise",
    model,
    tokensIn: reviseResult.tokensIn,
    tokensOut: reviseResult.tokensOut,
    latencyMs: Date.now() - t0,
    retried: false,
  });

  const intake = draft.intakeJson as Intake;
  const draftOutputForCritique: DraftOutput = {
    plan: draft.planJson as DraftOutput["plan"],
    text: reviseResult.revise.revised_text,
    facts_used: (draft.factsUsedJson as DraftOutput["facts_used"] | null) ?? [],
    placeholders: [],
  };
  const t1 = Date.now();
  const critiqueResult = await runCritiqueLoop(draftOutputForCritique, intake, groundingText, 1, instruction);
  await recordStageRun({
    draftId,
    stage: "critique",
    model,
    tokensIn: critiqueResult.tokensIn,
    tokensOut: critiqueResult.tokensOut,
    latencyMs: Date.now() - t1,
    retried: false,
  });

  const db = getDb();
  await stripKeyboard(draft);
  const [updated] = await db
    .update(drafts)
    .set({
      text: critiqueResult.text,
      checksJson: critiqueResult.checks,
      critiqueJson: critiqueResult.lastCritique,
      tokensIn: draft.tokensIn + reviseResult.tokensIn + critiqueResult.tokensIn,
      tokensOut: draft.tokensOut + reviseResult.tokensOut + critiqueResult.tokensOut,
      telegramMessageId: null,
    })
    .where(eq(drafts.id, draftId))
    .returning();
  if (!updated) throw new Error(`Draft ${draftId} vanished after edit`);
  await deliverDraft(updated);
}

export async function regenerateDraft(oldDraftId: string): Promise<string> {
  const db = getDb();
  const oldDraft = await getDraftOrThrow(oldDraftId);

  await stripKeyboard(oldDraft);
  await db
    .update(drafts)
    .set({ status: "superseded", decidedAt: new Date() })
    .where(eq(drafts.id, oldDraftId));

  const [newDraft] = await db
    .insert(drafts)
    .values({
      fragmentIds: oldDraft.fragmentIds,
      intakeJson: oldDraft.intakeJson as Intake,
      revisionOf: oldDraftId,
      stage: "intake",
    })
    .returning();
  if (!newDraft) throw new Error("Failed to create regenerated draft row");

  await db
    .update(fragments)
    .set({ usedInDraftId: newDraft.id })
    .where(inArray(fragments.id, oldDraft.fragmentIds));

  await continuePipeline(newDraft.id);
  return newDraft.id;
}
