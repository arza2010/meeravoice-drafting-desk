import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sessions, type Session } from "@/lib/db/schema";

const EDIT_FLOW_TTL_MS = 30 * 60 * 1000;

export async function startSession(
  chatId: number,
  mode: "edit" | "reject_reason",
  draftId: string,
): Promise<void> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + EDIT_FLOW_TTL_MS);
  await db
    .insert(sessions)
    .values({ chatId, mode, draftId, expiresAt })
    .onConflictDoUpdate({
      target: sessions.chatId,
      set: { mode, draftId, expiresAt },
    });
}

export async function getActiveSession(chatId: number): Promise<Session | null> {
  const db = getDb();
  const [row] = await db.select().from(sessions).where(eq(sessions.chatId, chatId)).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await clearSession(chatId);
    return null;
  }
  return row;
}

export async function clearSession(chatId: number): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.chatId, chatId));
}
