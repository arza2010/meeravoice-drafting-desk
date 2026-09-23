import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().min(1, "OPENAI_MODEL is required"),
  OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default("whisper-1"),

  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_CHAT_ID: z.string().min(1, "TELEGRAM_CHAT_ID is required"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, "TELEGRAM_WEBHOOK_SECRET is required"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Empty string (the common "unset" state for a Vercel env var / local
  // .env placeholder) is treated as unset rather than failing validation.
  APP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Lazily validated so a missing var fails loudly at first use (with a clear
 * message) instead of at random points deep in a request.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
