import { z } from "zod";

const chatSchema = z.object({
  id: z.number(),
  type: z.string(),
});

const voiceSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  duration: z.number(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const messageSchema = z.object({
  message_id: z.number(),
  chat: chatSchema,
  date: z.number(),
  text: z.string().optional(),
  caption: z.string().optional(),
  voice: voiceSchema.optional(),
  // Bot API >= 7.0 forwarded-message marker.
  forward_origin: z.unknown().optional(),
  // Legacy forwarded-message markers, kept for older clients/relays.
  forward_date: z.number().optional(),
  forward_from: z.unknown().optional(),
  forward_from_chat: z.unknown().optional(),
});

const callbackQuerySchema = z.object({
  id: z.string(),
  data: z.string().optional(),
  message: messageSchema.optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: messageSchema.optional(),
  channel_post: messageSchema.optional(),
  callback_query: callbackQuerySchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof messageSchema>;

export type ParsedEvent =
  | {
      kind: "content_message";
      updateId: number;
      chatId: number;
      messageId: number;
      isForwarded: boolean;
      text: string | null;
      voiceFileId: string | null;
    }
  | {
      kind: "callback_query";
      updateId: number;
      chatId: number;
      messageId: number;
      callbackQueryId: string;
      data: string;
    }
  | { kind: "unsupported"; updateId: number };

function isForwarded(message: TelegramMessage): boolean {
  return Boolean(
    message.forward_origin ||
      message.forward_date ||
      message.forward_from ||
      message.forward_from_chat,
  );
}

/**
 * Normalizes a raw Telegram update into a small discriminated union. Returns
 * null if the payload doesn't even parse as a Telegram update (malformed
 * request body).
 */
export function parseUpdate(raw: unknown): ParsedEvent | null {
  const result = telegramUpdateSchema.safeParse(raw);
  if (!result.success) return null;
  const update = result.data;

  const message = update.message ?? update.channel_post;
  if (message) {
    const text = message.text ?? message.caption ?? null;
    return {
      kind: "content_message",
      updateId: update.update_id,
      chatId: message.chat.id,
      messageId: message.message_id,
      isForwarded: isForwarded(message),
      text,
      voiceFileId: message.voice?.file_id ?? null,
    };
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    if (!cq.message) {
      return { kind: "unsupported", updateId: update.update_id };
    }
    return {
      kind: "callback_query",
      updateId: update.update_id,
      chatId: cq.message.chat.id,
      messageId: cq.message.message_id,
      callbackQueryId: cq.id,
      data: cq.data ?? "",
    };
  }

  return { kind: "unsupported", updateId: update.update_id };
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

/**
 * Recognises a leading bot command (e.g. "/draft 3" -> {name: "draft", args:
 * ["3"]}). Text that merely contains a slash mid-sentence is not a command -
 * only text/voice transcripts starting with "/" at position 0 qualify, and
 * even then the content is still logged as a fragment if it isn't one of the
 * commands the bot recognises (see constraints: content is data, not
 * instructions).
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!head) return null;
  const name = head.split("@")[0]?.toLowerCase();
  if (!name) return null;
  return { name, args: rest.filter(Boolean) };
}

export interface ParsedCallbackData {
  action: "approve" | "edit" | "regenerate" | "reject";
  draftId: string;
}

/** callback_data is authored only by this app's own keyboards.ts, never by user input. */
export function parseCallbackData(data: string): ParsedCallbackData | null {
  const [prefix, draftId, action] = data.split(":");
  if (prefix !== "draft" || !draftId || !action) return null;
  if (action !== "approve" && action !== "edit" && action !== "regenerate" && action !== "reject") {
    return null;
  }
  return { action, draftId };
}
