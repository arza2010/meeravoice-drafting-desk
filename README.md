# MeeraVoice Drafting Desk

Turns Meera Pillai's Telegram voice notes and text fragments into LinkedIn post drafts written in her voice, and sends each draft back to her on Telegram to approve, edit, regenerate or reject.

**This system never posts to LinkedIn.** Meera reviews, edits and publishes every post herself. There is no LinkedIn integration anywhere in this codebase.

Everything happens in Telegram: sending a voice note or text fragment, reviewing a draft, approving/editing/regenerating/rejecting it, and checking progress (`/status`). There is no web UI.

## How it works

```
Telegram (voice/text/forwarded note)
  -> POST /api/telegram/webhook   (verify secret, allowlist chat, dedupe update_id, return 200 fast)
  -> waitUntil(process):
      1. Ingest     download voice via getFile -> transcribe (OpenAI) -> store fragment -> discard audio
      2. Intake     LLM stage 1: clean, extract claims + facts with source spans, score substance
                    not draftable -> bank it, tell Meera what's missing, stop
      2b. News      best-effort web search (OpenAI hosted tool) for relevant recent context;
                    unverified - informs angle/hook only, never a citable fact, see below
      3. Angles     LLM stage 2 (Tree of Thoughts): 3 candidate angles -> score -> select
      4. Draft      LLM stage 3 (Chain of Thought): plan fields -> draft
      5. Checks     deterministic code checks (length, mechanics, banned words, spelling, unsupported numbers)
      6. Critique   LLM stage 4: checklist review + revise (max 2 loops, then send with flags)
      7. Deliver    sendMessage to Meera with inline buttons [Approve] [Edit] [Regenerate] [Reject]
  -> callback_query / reply handling -> status updates, revision (LLM stage 5), clean copy on approve
```

Every stage's output is persisted to Postgres before moving to the next (`drafts.stage` tracks progress), so a crash or timeout mid-pipeline never loses or re-bills a completed stage.

### Recent-context (news) lookup

After intake, the pipeline searches Google News RSS (free, no API key - `https://news.google.com/rss/search`) for anything genuinely relevant and recent to the fragment's topic, so a draft can feel current when that's actually warranted. This is deliberately kept outside the fact-grounding system:

- It's **never a citable source**. The angle and draft prompts are explicit that any specific number, study, or named claim drawn from it must be placeholdered as `[NEEDS VERIFICATION: ...]`, exactly like an uncited claim from anywhere else - it can never be stated as settled fact or attributed to Meera/Skinstinct.
- It may only shape **general framing or angle selection** (e.g. preferring a timely angle, a passing "there's been renewed attention to X" line) - not specific claims.
- If nothing turns up relevant, the prompts explicitly tell the model to ignore it rather than force a connection - a bolted-on "in the news" reference reads as generic AI copy.
- It's **optional and fails open**: a timeout, network error, or empty feed just means no news context that run, never a blocked draft.
- Real headlines and links, not LLM prose: because RSS results are literal (title/source/link/date), there's no risk of an LLM paraphrasing or misattributing a source the way a web-search *tool* could. Relevance is still unverified - that judgment stays with the angle/draft prompts.
- **Delivery shows the outcome, not just whether it ran.** Every draft's header line ends with one of `news: none found` / `news: found, unused` / `news: referenced` (`drafts.news_context_used`, self-reported by the draft stage). When anything was found, the delivered message includes a "Related coverage" section with the real titles and links, whether or not the draft used them, so Meera can check the sources herself.

## 5-minute setup

1. **Create the bot.** Message [@BotFather](https://t.me/BotFather) on Telegram, `/newbot`, get the token. Add the bot as an admin of the channel Meera will use (if using a channel rather than a private chat).
2. **Get your chat/channel ID.** Forward any message from the target chat to [@userinfobot](https://t.me/userinfobot), or check the first ignored update's logged `chat_id` in the `telegram_updates` table after step 6 below (channel/supergroup IDs are negative and start with `-100`).
3. **Provision Postgres.** In the Vercel dashboard: Storage -> Marketplace -> Neon -> Create. Copy the connection string.
4. **Set environment variables** (locally in `.env`, and in Vercel Project Settings -> Environment Variables) - see the table below.
5. **Deploy to Vercel**: `vercel --prod`, or connect the GitHub repo in the Vercel dashboard.
6. **Run migrations** against the deployed database: `DATABASE_URL=<neon-url> npm run db:migrate`.
7. **Point the webhook at the deployment**: set `APP_URL` to the deployed URL, then `npm run set-webhook`.
8. **Send a test voice note** to the bot. Within about 90 seconds you should get a draft back with `[Approve] [Edit] [Regenerate] [Reject]` buttons.

### Environment variables

| Variable | Where it's used | Notes |
|---|---|---|
| `OPENAI_API_KEY` | drafting + transcription | |
| `OPENAI_MODEL` | drafting/intake/angles/critique | Set to the most capable text model on your account. No model name is hardcoded anywhere in the code. |
| `OPENAI_TRANSCRIBE_MODEL` | transcription | Defaults to `whisper-1`. |
| `TELEGRAM_BOT_TOKEN` | all Telegram API calls | From BotFather. |
| `TELEGRAM_CHAT_ID` | webhook allowlist | Only this chat is ever processed; everything else is ignored and logged. |
| `TELEGRAM_WEBHOOK_SECRET` | webhook verification | Generate with `openssl rand -hex 32`. Must match what `npm run set-webhook` registers. |
| `DATABASE_URL` | all persistence | Neon Postgres connection string. |
| `APP_URL` | `npm run set-webhook`, `npm run smoke` | Your deployed URL, e.g. `https://meeravoice.vercel.app`. Not read by the running app itself. |

`.env.example` lists these with empty values. `.env` is gitignored - never commit real credentials.

## Backfilling Meera's 60 existing notes

The Telegram Bot API can't read chat history from before the bot joined. To backfill: forward each old voice note or text fragment to the bot chat, one at a time. A forwarded message is ingested identically to a fresh one (tagged `source: "forward"`), goes through the same intake -> angles -> draft -> critique -> deliver pipeline, and produces a draft the same way. There's no bulk-import path - forwarding is the only way the Bot API exposes old messages, so it's also the only backfill path here.

## Bot commands

- `/start` - help text
- `/bank` - count and short list of undrafted fragments
- `/draft [n]` - combine the last n undrafted fragments (default 3) into one candidate
- `/status` - posts approved this week against the 3/week target
- `/forget <id>` - delete a fragment and its drafts (id prefix from `/bank` is enough)
- `/cancel` - exit an active edit/reject flow

## Cost per draft

Every LLM call (intake, angles, draft, critique, revise) is logged to the `stage_runs` table with its model, token counts and latency. There's no dashboard, so query it directly, e.g. with `npm run db:studio` (Drizzle Studio) or `psql`:

```sql
select
  d.seq,
  sr.stage,
  sr.model,
  sr.tokens_in,
  sr.tokens_out
from stage_runs sr
join drafts d on d.id = sr.draft_id
where d.id = '<draft-uuid>'
order by sr.created_at;
```

`lib/pricing.ts` holds a small maintained USD-per-million-token table for common OpenAI models if you want to turn token counts into a dollar estimate yourself; it's not wired into any UI since there isn't one.

## Testing

```bash
npm test        # unit tests: deterministic checks, webhook guard (secret/allowlist/dedupe), callback/command parsing
npm run eval     # Appendix C: 10 end-to-end cases against the real OpenAI API and a scratch Postgres
npm run smoke    # post-deploy: health check + webhook guard checks against a live deployment (set APP_URL first)
```

`npm run eval` and `npm run smoke` (via `npm run eval`'s `evals/localDb.ts`) boot a throwaway local Postgres automatically via `embedded-postgres` if `DATABASE_URL` isn't already set, so both work with zero setup. **`npm run eval` makes real calls to the OpenAI API** (roughly 25-30 calls across the 10 cases) and will incur real usage cost.

Last verified eval run: **10/10 cases passed** against `gpt-4o`.

## Known limits and assumptions

- **`maxDuration = 300`** on the webhook route assumes a Vercel Pro plan or above (Hobby caps a function at 60s, which transcription plus 4-5 sequential LLM calls can exceed). See `docs/decisions.md`.
- **Resumability is "resume if re-invoked," not "auto-retried."** Each pipeline stage is persisted (`drafts.stage`), and `continuePipeline(draftId)` will pick up from the last completed stage - but nothing currently re-invokes it automatically if a webhook's background `waitUntil` work throws or times out mid-pipeline. In that case Meera gets an error message telling her to retry via `/draft`, rather than a silent automatic retry. Building a cron-based auto-retry queue was out of scope for this build.
- **The unsupported-number check is a heuristic**, not a semantic fact-checker: it extracts numeric tokens from the draft and confirms each one appears (with word-boundary matching, so e.g. a bare "50" can't falsely match inside "50%") somewhere in the source transcript(s) or `brand-facts.md`. It was caught fabricating a false negative during eval testing (see `docs/decisions.md`) and fixed, but it's still a literal-presence check, not a full grounding verifier - the critique LLM stage and Meera's own review remain the real backstop.
- **Named-competitor avoidance is enforced by the critique LLM**, not deterministic code (a competitor's name isn't a fixed, predictable string). See `docs/decisions.md`.
- **The lexicon/spelling banned-term lists are maintained arrays** in `lib/checks/lexicon.ts` and `lib/checks/spelling.ts`, not parsed live from `references/lexicon.md` (its prose mixes bare terms with parenthetical caveats that aren't reliably machine-parseable). Keep them in sync by hand if the source file changes.
- **No dashboard.** The original brief specified one; it was built and verified working (build, typecheck, and a live browser check of the login/auth flow all passed), then removed at the user's explicit request partway through the build to keep the system Telegram-only. See `docs/decisions.md`. If you want it back later, it's a straightforward rebuild against `lib/db/schema.ts` (a Next.js App Router route group, a password gate via a signed cookie in middleware, and read queries over `drafts`/`fragments`/`stage_runs`) - none of the removed code is still in this repo.
- **`OPENAI_MODEL` and pricing table currency.** `lib/pricing.ts`'s per-model USD rates are a point-in-time snapshot and will drift; update them if you rely on the cost-estimate SQL/helper above.

## Repo layout

```
/app
  /api/telegram/webhook/route.ts   webhook entry point
  /api/health/route.ts             health check
/lib
  env.ts  db/{schema.ts,client.ts}
  telegram/{api.ts,guard.ts,parse.ts,keyboards.ts,flows.ts,commands.ts,handlers.ts}
  pipeline/{ingest.ts,intake.ts,news.ts,angles.ts,draft.ts,critique.ts,revise.ts,run.ts,actions.ts,context.ts,schemas.ts}
  checks/{index.ts,numbers.ts,spelling.ts,lexicon.ts}
  openai.ts  corpus.ts  skill.ts  pricing.ts
/prompts  intake.ts angles.ts draft.ts critique.ts revise.ts   (built from /content/meera-voice)
/content  meera-voice/**  voice-corpus.json
/evals    cases.json  run.ts  localDb.ts
/scripts  set-webhook.ts  smoke.ts  migrate.ts
/docs     decisions.md
drizzle.config.ts  .env.example
```
