import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every processed Telegram update, keyed by its own update_id so retried
 * deliveries never produce a second fragment/draft. `chat_id` is logged even
 * for ignored updates so a misconfigured TELEGRAM_CHAT_ID is discoverable
 * from the DB instead of only from Vercel logs.
 */
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }),
  status: text("status", {
    enum: ["ignored", "processing", "done", "error"],
  }).notNull(),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fragmentSourceEnum = pgEnum("fragment_source", ["voice", "text", "forward"]);

export const fragments = pgTable("fragments", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: fragmentSourceEnum("source").notNull(),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  transcript: text("transcript").notNull(),
  // Stage 1 (intake) output. Null until intake has run.
  intakeJson: jsonb("intake_json"),
  draftable: boolean("draftable"),
  usedInDraftId: uuid("used_in_draft_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const draftStatusEnum = pgEnum("draft_status", [
  "pending",
  "approved",
  "rejected",
  "superseded",
  "failed",
]);

/**
 * `stage` tracks how far this draft's pipeline run has gotten, so a crash or
 * timeout mid-pipeline resumes from the last completed stage instead of
 * restarting (and re-billing) the whole thing.
 */
export const draftStageEnum = pgEnum("draft_stage", [
  "intake",
  "angles",
  "draft",
  "critique",
  "delivered",
]);

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  seq: serial("seq").notNull(),
  fragmentIds: jsonb("fragment_ids").$type<string[]>().notNull(),
  // The intake output that fed this draft. Usually mirrors the single source
  // fragment's own intake_json, but can differ when /draft combines several
  // undrafted fragments into one candidate.
  intakeJson: jsonb("intake_json").notNull(),
  // Best-effort, unverified web-search context (recent industry/news items)
  // used to make angle selection feel current. Never a citable fact source -
  // see prompts/angles.ts and prompts/draft.ts. Null when the lookup found
  // nothing relevant or the model doesn't support web search.
  newsContext: text("news_context"),
  pillar: text("pillar"),
  anglesJson: jsonb("angles_json"),
  selectedAngle: text("selected_angle"),
  planJson: jsonb("plan_json"),
  factsUsedJson: jsonb("facts_used_json"),
  // Whether the draft stage actually incorporated newsContext into the text
  // (vs. it being fetched but judged irrelevant/unused). Null until the
  // draft stage has run.
  newsContextUsed: boolean("news_context_used"),
  text: text("text"),
  checksJson: jsonb("checks_json"),
  critiqueJson: jsonb("critique_json"),
  revisionOf: uuid("revision_of"),
  status: draftStatusEnum("status").notNull().default("pending"),
  stage: draftStageEnum("stage").notNull().default("intake"),
  rejectReason: text("reject_reason"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/**
 * One row per LLM call: token usage per stage for cost auditing, and a
 * resumable pipeline's audit trail of what's already run for a draft.
 */
export const stageRuns = pgTable("stage_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Intake runs against a fragment, before a draft row exists; every later
  // stage runs against a draft. Exactly one of the two is set.
  fragmentId: uuid("fragment_id"),
  draftId: uuid("draft_id"),
  stage: text("stage", {
    enum: ["intake", "news", "angles", "draft", "critique", "revise"],
  }).notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  retried: boolean("retried").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Edit-flow state keyed by chat. After Meera taps Edit, the next message
 * from her chat is treated as an edit instruction for `draftId` until
 * `expiresAt` or /cancel.
 */
export const sessionModeEnum = pgEnum("session_mode", ["edit", "reject_reason"]);

export const sessions = pgTable("sessions", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  mode: sessionModeEnum("mode").notNull(),
  draftId: uuid("draft_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Fragment = typeof fragments.$inferSelect;
export type NewFragment = typeof fragments.$inferInsert;
export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
export type StageRun = typeof stageRuns.$inferSelect;
export type Session = typeof sessions.$inferSelect;
