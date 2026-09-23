import "dotenv/config";

/**
 * Post-deployment smoke test. Safe and non-destructive: it never sends a
 * real Telegram message or creates a real fragment/draft. It just confirms
 * the deployed app is reachable and its guards are actually live.
 */

const APP_URL = process.env.APP_URL;

async function main() {
  if (!APP_URL) {
    throw new Error("APP_URL is required (e.g. https://meeravoice.vercel.app)");
  }
  const base = APP_URL.replace(/\/$/, "");
  const results: { name: string; ok: boolean; detail?: string }[] = [];

  // 1. Health check.
  try {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    results.push({ name: "GET /api/health returns ok", ok: res.ok && body.ok === true, detail: JSON.stringify(body) });
  } catch (err) {
    results.push({ name: "GET /api/health returns ok", ok: false, detail: String(err) });
  }

  // 2. Webhook rejects a request with no/wrong secret header.
  try {
    const res = await fetch(`${base}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: JSON.stringify({ update_id: 1 }),
    });
    results.push({
      name: "POST /api/telegram/webhook rejects a wrong secret (401)",
      ok: res.status === 401,
      detail: `status ${res.status}`,
    });
  } catch (err) {
    results.push({ name: "POST /api/telegram/webhook rejects a wrong secret (401)", ok: false, detail: String(err) });
  }

  // 3. Webhook accepts a well-formed, correctly-signed request and returns fast.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    try {
      const start = Date.now();
      const res = await fetch(`${base}/api/telegram/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
        // update_id far outside normal range, from an unconfigured chat, so nothing real happens.
        body: JSON.stringify({
          update_id: -1,
          message: { message_id: 1, chat: { id: -1, type: "private" }, date: 0, text: "smoke test" },
        }),
      });
      const elapsedMs = Date.now() - start;
      results.push({
        name: "POST /api/telegram/webhook with a valid secret returns 200 quickly",
        ok: res.ok && elapsedMs < 5000,
        detail: `status ${res.status}, ${elapsedMs}ms`,
      });
    } catch (err) {
      results.push({
        name: "POST /api/telegram/webhook with a valid secret returns 200 quickly",
        ok: false,
        detail: String(err),
      });
    }
  } else {
    results.push({
      name: "POST /api/telegram/webhook with a valid secret returns 200 quickly",
      ok: false,
      detail: "skipped - TELEGRAM_WEBHOOK_SECRET not set locally",
    });
  }

  console.log("\n=== Smoke test results ===\n");
  let allOk = true;
  for (const r of results) {
    console.log(`[${r.ok ? "OK" : "FAIL"}] ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
    if (!r.ok) allOk = false;
  }
  console.log("");

  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
