import { getEnv } from "@/lib/env";

const TELEGRAM_API_TIMEOUT_MS = 15_000;

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

function apiBase(): string {
  return `https://api.telegram.org/bot${getEnv().TELEGRAM_BOT_TOKEN}`;
}

function fileBase(): string {
  return `https://api.telegram.org/file/bot${getEnv().TELEGRAM_BOT_TOKEN}`;
}

async function callTelegram<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!res.ok || !body.ok) {
      throw new TelegramApiError(
        `Telegram ${method} failed: ${body.description ?? res.statusText}`,
        method,
      );
    }
    return body.result as T;
  } catch (err) {
    if (err instanceof TelegramApiError) throw err;
    throw new TelegramApiError(`Telegram ${method} request failed`, method, err);
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  options?: { replyMarkup?: unknown; replyToMessageId?: number },
): Promise<{ message_id: number }> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: options?.replyMarkup,
    reply_to_message_id: options?.replyToMessageId,
  });
}

export async function editMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  replyMarkup: unknown,
): Promise<void> {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export async function getFile(fileId: string): Promise<TelegramFile> {
  return callTelegram<TelegramFile>("getFile", { file_id: fileId });
}

/**
 * Downloads a voice note and returns it as a Buffer named with a `.ogg`
 * extension. Telegram voice notes are OGG/Opus; renaming away from Telegram's
 * `.oga` avoids the transcription endpoint rejecting the extension.
 */
export async function downloadVoiceFile(fileId: string): Promise<Buffer> {
  const file = await getFile(fileId);
  if (!file.file_path) {
    throw new TelegramApiError("Telegram file has no file_path", "getFile");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${fileBase()}/${file.file_path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new TelegramApiError(`Failed to download file: ${res.statusText}`, "downloadFile");
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await callTelegram("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "channel_post", "callback_query"],
  });
}

export async function getWebhookInfo(): Promise<unknown> {
  return callTelegram("getWebhookInfo", {});
}
