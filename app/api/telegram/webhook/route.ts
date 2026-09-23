import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { telegramUpdates } from "@/lib/db/schema";
import { verifyWebhookSecret, isAllowedChat } from "@/lib/telegram/guard";
import { parseUpdate } from "@/lib/telegram/parse";
import { handleParsedEvent } from "@/lib/telegram/handlers";

export const runtime = "nodejs";
// Vercel Pro/Enterprise allow up to 300s (800s with Fluid compute) for a
// serverless function; the pipeline can run transcription plus 4-5 LLM
// calls sequentially, which comfortably needs more than Hobby's 60s cap.
// See README "Deployment" for the Hobby-plan caveat.
export const maxDuration = 300;

async function processEventSafely(updateId: number, event: Parameters<typeof handleParsedEvent>[0]) {
  const db = getDb();
  try {
    await handleParsedEvent(event);
    await db.update(telegramUpdates).set({ status: "done" }).where(eq(telegramUpdates.updateId, updateId));
  } catch (err) {
    await db
      .update(telegramUpdates)
      .set({ status: "error", error: err instanceof Error ? err.message.slice(0, 2000) : String(err) })
      .where(eq(telegramUpdates.updateId, updateId));
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // malformed body; nothing Telegram will usefully retry
  }

  const event = parseUpdate(body);
  if (!event) {
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  const chatId = "chatId" in event ? event.chatId : null;

  const inserted = await db
    .insert(telegramUpdates)
    .values({ updateId: event.updateId, chatId, status: "processing" })
    .onConflictDoNothing({ target: telegramUpdates.updateId })
    .returning();

  if (inserted.length === 0) {
    // Already processed (or in flight) - Telegram retried a slow/failed delivery.
    return NextResponse.json({ ok: true });
  }

  if (event.kind === "unsupported") {
    await db
      .update(telegramUpdates)
      .set({ status: "done" })
      .where(eq(telegramUpdates.updateId, event.updateId));
    return NextResponse.json({ ok: true });
  }

  if (chatId !== null && !isAllowedChat(chatId)) {
    await db
      .update(telegramUpdates)
      .set({ status: "ignored" })
      .where(eq(telegramUpdates.updateId, event.updateId));
    return NextResponse.json({ ok: true });
  }

  waitUntil(processEventSafely(event.updateId, event));

  return NextResponse.json({ ok: true });
}
