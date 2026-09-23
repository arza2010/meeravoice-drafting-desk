import { getDb } from "@/lib/db/client";
import { fragments, type Fragment } from "@/lib/db/schema";
import { downloadVoiceFile } from "@/lib/telegram/api";
import { transcribeAudio } from "@/lib/openai";

export type FragmentSource = "voice" | "text" | "forward";

/**
 * Downloads a Telegram voice note and transcribes it. The audio buffer is
 * only ever held in memory for this call - it is never written to disk or
 * the DB, so "discarding" it is simply letting it fall out of scope.
 */
export async function transcribeVoiceNote(fileId: string): Promise<string> {
  const buffer = await downloadVoiceFile(fileId);
  const text = await transcribeAudio(buffer, "voice-note.ogg");
  return text;
}

export async function createFragment(input: {
  source: FragmentSource;
  telegramMessageId: number;
  transcript: string;
}): Promise<Fragment> {
  const db = getDb();
  const [row] = await db
    .insert(fragments)
    .values({
      source: input.source,
      telegramMessageId: input.telegramMessageId,
      transcript: input.transcript,
    })
    .returning();
  if (!row) throw new Error("Failed to insert fragment");
  return row;
}
