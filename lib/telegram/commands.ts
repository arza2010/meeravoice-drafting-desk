import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { drafts, fragments } from "@/lib/db/schema";
import { sendMessage } from "@/lib/telegram/api";
import type { ParsedCommand } from "@/lib/telegram/parse";
import { clearSession } from "@/lib/telegram/flows";
import { startPipelineForFragments } from "@/lib/pipeline/run";

const HELP_TEXT = `MeeraVoice Drafting Desk

Send a voice note, text fragment, or forward an old note - I'll turn it into a LinkedIn draft in your voice and send it back here for you to approve, edit, regenerate or reject.

Commands:
/bank - see undrafted fragments
/draft [n] - combine the last n undrafted fragments (default 3) into one candidate
/status - posts approved this week vs target
/forget <id> - delete a fragment and its drafts
/cancel - exit an active edit/reject flow

Nothing is ever posted to LinkedIn from here. You always publish it yourself.`;

function startOfIsoWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

async function handleBank(chatId: number): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(fragments)
    .where(isNull(fragments.usedInDraftId))
    .orderBy(desc(fragments.createdAt))
    .limit(20);

  if (rows.length === 0) {
    await sendMessage(chatId, "Nothing banked right now - every fragment has already been drafted or used.");
    return;
  }

  const lines = rows.map((f) => {
    const excerpt = f.transcript.length > 70 ? `${f.transcript.slice(0, 67)}...` : f.transcript;
    const draftableNote = f.draftable === false ? " (not enough alone yet)" : "";
    return `- [${f.id.slice(0, 8)}] ${excerpt}${draftableNote}`;
  });

  await sendMessage(
    chatId,
    `${rows.length} undrafted fragment${rows.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n\nUse /draft [n] to combine the most recent ones into a candidate.`,
  );
}

async function handleDraftCommand(chatId: number, args: string[]): Promise<void> {
  const n = args[0] ? Number.parseInt(args[0], 10) : 3;
  const count = Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 3;

  const db = getDb();
  const rows = await db
    .select()
    .from(fragments)
    .where(isNull(fragments.usedInDraftId))
    .orderBy(desc(fragments.createdAt))
    .limit(count);

  if (rows.length === 0) {
    await sendMessage(chatId, "No undrafted fragments to combine. Send a note first.");
    return;
  }

  const orderedOldestFirst = [...rows].reverse();
  const fragmentIds = orderedOldestFirst.map((f) => f.id);

  await sendMessage(chatId, `Combining ${fragmentIds.length} fragment(s) into one candidate...`);
  const result = await startPipelineForFragments(fragmentIds);
  if (result.kind === "not_draftable") {
    await sendMessage(
      chatId,
      `Still not enough to draft, even combined.\n\nMissing:\n${result.missingInfo.map((m) => `- ${m}`).join("\n")}`,
    );
  }
}

async function handleStatus(chatId: number): Promise<void> {
  const db = getDb();
  const weekStart = startOfIsoWeek(new Date());
  const approvedThisWeek = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, "approved"), gte(drafts.decidedAt, weekStart)));

  const pending = await db.select().from(drafts).where(eq(drafts.status, "pending"));
  const banked = await db.select().from(fragments).where(isNull(fragments.usedInDraftId));

  const TARGET_PER_WEEK = 3;
  await sendMessage(
    chatId,
    `This week: ${approvedThisWeek.length}/${TARGET_PER_WEEK} approved.\nPending review: ${pending.length}.\nFragments banked: ${banked.length}.`,
  );
}

async function handleForget(chatId: number, args: string[]): Promise<void> {
  const idPrefix = args[0];
  if (!idPrefix) {
    await sendMessage(chatId, "Usage: /forget <fragment id> (see /bank for ids)");
    return;
  }

  const db = getDb();
  const all = await db.select().from(fragments);
  const match = all.find((f) => f.id === idPrefix || f.id.startsWith(idPrefix));
  if (!match) {
    await sendMessage(chatId, `No fragment found matching "${idPrefix}".`);
    return;
  }

  const allDrafts = await db.select().from(drafts);
  const relatedDrafts = allDrafts.filter((d) => d.fragmentIds.includes(match.id));
  for (const d of relatedDrafts) {
    await db.delete(drafts).where(eq(drafts.id, d.id));
  }
  await db.delete(fragments).where(eq(fragments.id, match.id));

  await sendMessage(
    chatId,
    `Forgotten: fragment ${match.id.slice(0, 8)} and ${relatedDrafts.length} related draft(s).`,
  );
}

export async function handleCommand(chatId: number, command: ParsedCommand): Promise<void> {
  switch (command.name) {
    case "start":
      await sendMessage(chatId, HELP_TEXT);
      return;
    case "bank":
      await handleBank(chatId);
      return;
    case "draft":
      await handleDraftCommand(chatId, command.args);
      return;
    case "status":
      await handleStatus(chatId);
      return;
    case "forget":
      await handleForget(chatId, command.args);
      return;
    case "cancel":
      await clearSession(chatId);
      await sendMessage(chatId, "Cancelled.");
      return;
    default:
      await sendMessage(chatId, `Unknown command /${command.name}. Send /start for help.`);
  }
}
