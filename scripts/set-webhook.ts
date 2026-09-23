import "dotenv/config";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;

  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
  if (!appUrl) {
    throw new Error(
      "APP_URL is required (your deployed Vercel URL, e.g. https://meeravoice.vercel.app)",
    );
  }

  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "channel_post", "callback_query"],
    }),
  });

  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error("Failed to set webhook:", body);
    process.exit(1);
  }

  console.log(`Webhook set to ${webhookUrl}`);
  console.log(body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
