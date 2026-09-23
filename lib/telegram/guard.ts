import { getEnv } from "@/lib/env";

/**
 * Constant-time-ish comparison isn't critical here (the secret isn't a
 * high-value crypto key being brute-forced over this channel), but we avoid
 * short-circuit string equality footguns by comparing lengths first.
 */
export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = getEnv().TELEGRAM_WEBHOOK_SECRET;
  if (!headerValue || headerValue.length !== expected.length) return false;
  return headerValue === expected;
}

/** Only the configured chat may produce fragments/drafts. Everything else is ignored. */
export function isAllowedChat(chatId: number): boolean {
  return String(chatId) === getEnv().TELEGRAM_CHAT_ID;
}
