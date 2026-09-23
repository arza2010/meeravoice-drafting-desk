// Fake but well-formed values so lib/env.ts validates during unit tests.
// No real credentials here; tests never make network calls with these.
process.env.OPENAI_API_KEY ??= "sk-test-000000000000000000000000000000000000";
process.env.OPENAI_MODEL ??= "gpt-4o";
process.env.OPENAI_TRANSCRIBE_MODEL ??= "whisper-1";
process.env.TELEGRAM_BOT_TOKEN ??= "123456789:TEST-TOKEN-AAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.TELEGRAM_CHAT_ID ??= "-1001234567890";
process.env.TELEGRAM_WEBHOOK_SECRET ??= "test-webhook-secret-00000000000000000000";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
