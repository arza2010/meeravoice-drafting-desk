import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const pieceSchema = z.object({
  id: z.string(),
  format: z.enum(["linkedin_post", "newsletter"]),
  category: z.string(),
  pillar: z.enum([
    "Formulation Literacy",
    "Industry Transparency",
    "Founder Proof",
    "Built for India",
  ]),
  char_count: z.number(),
  text: z.string(),
  subject: z.string().optional(),
});

export type CorpusPiece = z.infer<typeof pieceSchema>;

let cached: CorpusPiece[] | undefined;

export function loadCorpus(): CorpusPiece[] {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "content", "voice-corpus.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  cached = z.array(pieceSchema).parse(JSON.parse(raw));
  return cached;
}

/**
 * Deterministic exemplar selection: pillar match first, then LinkedIn posts
 * before newsletters, tie-broken by id. Never random - the same angle always
 * gets the same exemplars, which keeps drafts and evals reproducible.
 */
export function selectExemplars(pillar: string, count = 2): CorpusPiece[] {
  const all = loadCorpus();
  const rank = (p: CorpusPiece): number => {
    let score = 0;
    if (p.pillar === pillar) score -= 100;
    if (p.format === "linkedin_post") score -= 10;
    return score;
  };
  return [...all]
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    .slice(0, count);
}
