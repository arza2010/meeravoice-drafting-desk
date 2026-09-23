import { z } from "zod";

export const PILLARS = [
  "Formulation Literacy",
  "Industry Transparency",
  "Founder Proof",
  "Built for India",
] as const;

export const pillarSchema = z.enum(PILLARS);

// ---------------------------------------------------------------------------
// Stage 1: Intake
// ---------------------------------------------------------------------------

export const factSourceSchema = z.enum(["transcript", "brand_facts", "transcript+brand_facts"]);

export const intakeSchema = z.object({
  clean_transcript: z.string(),
  core_claim: z.string(),
  facts: z.array(
    z.object({
      fact: z.string(),
      source: factSourceSchema,
    }),
  ),
  candidate_pillars: z.array(pillarSchema),
  substance_score: z.number().int().min(1).max(5),
  draftable: z.boolean(),
  missing_info: z.array(z.string()),
});

export type Intake = z.infer<typeof intakeSchema>;

// ---------------------------------------------------------------------------
// Stage 2: Angles (Tree of Thoughts)
// ---------------------------------------------------------------------------

export const hookTypeSchema = z.enum([
  "label_reversal",
  "dated_scene",
  "hard_data",
  "industry_moment",
]);

export const audienceSchema = z.enum(["consumer", "operator", "dual"]);

export const angleScoresSchema = z.object({
  gap_clarity: z.number().int().min(1).max(5),
  specificity_available: z.number().int().min(1).max(5),
  dual_audience: z.number().int().min(1).max(5),
  voice_fit: z.number().int().min(1).max(5),
  fact_risk: z.number().int().min(1).max(5),
  novelty: z.number().int().min(1).max(5),
});

export const angleSchema = z.object({
  id: z.enum(["A", "B", "C"]),
  pillar: pillarSchema,
  hook_type: hookTypeSchema,
  audience: audienceSchema,
  hook: z.string(),
  gap: z.string(),
  reader_test: z.string(),
  depends_on_facts: z.array(z.string()),
  scores: angleScoresSchema,
  pruned: z.boolean(),
  prune_reason: z.string().nullable(),
});

export const anglesSchema = z.object({
  angles: z.array(angleSchema).length(3),
  selected: z.enum(["A", "B", "C"]),
  why: z.string(),
});

export type Angles = z.infer<typeof anglesSchema>;
export type Angle = z.infer<typeof angleSchema>;

// ---------------------------------------------------------------------------
// Stage 3: Draft (Chain of Thought)
// ---------------------------------------------------------------------------

export const draftPlanSchema = z.object({
  hook: z.string(),
  turn: z.string(),
  mechanism: z.array(z.string()).length(3),
  bounding: z.string(),
  skinstinct_line: z.string().nullable(),
  reader_test: z.string(),
  close: z.string(),
});

export type DraftPlan = z.infer<typeof draftPlanSchema>;

export const draftOutputSchema = z.object({
  plan: draftPlanSchema,
  text: z.string(),
  facts_used: z.array(
    z.object({
      fact: z.string(),
      source: factSourceSchema,
    }),
  ),
  placeholders: z.array(z.string()),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;

// ---------------------------------------------------------------------------
// Stage 4: Critique + revise
// ---------------------------------------------------------------------------

export const critiqueItemSchema = z.object({
  n: z.number().int(),
  pass: z.boolean(),
  quote: z.string().nullable(),
  fix: z.string().nullable(),
});

export const critiqueSchema = z.object({
  items: z.array(critiqueItemSchema),
  revised_text: z.string(),
  remaining_flags: z.array(z.string()),
});

export type Critique = z.infer<typeof critiqueSchema>;

// ---------------------------------------------------------------------------
// Stage 5: Revise from Meera's instruction
// ---------------------------------------------------------------------------

export const reviseSchema = z.object({
  revised_text: z.string(),
  changes_summary: z.string(),
  remaining_flags: z.array(z.string()),
});

export type Revise = z.infer<typeof reviseSchema>;

// ---------------------------------------------------------------------------
// Deterministic checks (computed in code; see lib/checks)
// ---------------------------------------------------------------------------

export const checksResultSchema = z.object({
  char_count: z.number(),
  char_count_status: z.enum(["ok", "warn_short", "warn_long", "fail_over_ceiling"]),
  hook_len: z.number(),
  hook_len_status: z.enum(["ok", "warn_long"]),
  emoji_violations: z.array(z.string()),
  hashtag_violations: z.array(z.string()),
  exclamation_violations: z.array(z.string()),
  em_dash_violations: z.array(z.string()),
  en_dash_violations: z.array(z.string()),
  bullet_violations: z.array(z.string()),
  bold_violations: z.array(z.string()),
  lexicon_violations: z.array(z.object({ term: z.string(), index: z.number() })),
  spelling_violations: z.array(
    z.object({ american: z.string(), british: z.string(), index: z.number() }),
  ),
  unsupported_numbers: z.array(z.string()),
  bounding_count: z.number(),
  bounding_count_status: z.enum(["ok", "warn_zero", "warn_many"]),
  passed: z.boolean(),
});

export type ChecksResult = z.infer<typeof checksResultSchema>;
