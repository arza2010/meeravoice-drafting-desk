import { loadSkillFiles } from "@/lib/skill";
import type { Intake } from "@/lib/pipeline/schemas";
import type { RecentPostSummary } from "@/prompts/types";

export interface AnglesPromptInput {
  intake: Intake;
  recentPosts: RecentPostSummary[];
  meeraFeedback: string[];
}

function renderRecentPosts(posts: RecentPostSummary[]): string {
  if (posts.length === 0) return "(none published through this system yet)";
  return posts.map((p) => `- [${p.pillar}${p.hookType ? ` / ${p.hookType}` : ""}] ${p.firstLine}`).join("\n");
}

function renderFeedback(feedback: string[]): string {
  if (feedback.length === 0) return "(no rejections yet)";
  return feedback.map((f) => `- ${f}`).join("\n");
}

/** Stage 2 (angles): Tree of Thoughts, temperature ~0.8. */
export function buildAnglesPrompt(input: AnglesPromptInput): string {
  const skill = loadSkillFiles();

  return `<role>You are Meera's content strategist. You know her voice skill completely.</role>

<task>Generate exactly 3 distinct angles for a LinkedIn post from this material, evaluate each, prune weak ones, and select one.</task>

<context>
<intake>
${JSON.stringify(input.intake, null, 2)}
</intake>

<linkedin_structure>
${skill.linkedin}
</linkedin_structure>

<pillars>
${skill.pillars}
</pillars>

<recent_posts>
${renderRecentPosts(input.recentPosts)}
</recent_posts>

<meera_feedback>
${renderFeedback(input.meeraFeedback)}
</meera_feedback>
</context>

<thinking_procedure>
1. BRANCH: Produce 3 angles (ids "A", "B", "C") that differ from each other in at least two of: pillar, hook_type (label_reversal | dated_scene | hard_data | industry_moment), audience (consumer | operator | dual).
2. For each angle, write: the hook (aim for under 140 characters; it must contain a number, place, date, or verbatim label claim that exists in the intake's facts), the gap it closes, the reader test, and depends_on_facts listing exactly which intake facts (verbatim or close to it) it relies on.
3. EVALUATE each angle 1-5 on: gap_clarity, specificity_available (score high only for facts that are actually present in intake.facts), dual_audience (fit for LinkedIn's dual consumer/operator readership), voice_fit, fact_risk (1 = low risk of an unsupported claim), novelty (penalise an angle whose pillar+hook_type combination matches either of the last 2 recent_posts).
4. PRUNE: set pruned=true with a prune_reason for any angle that depends on a fact not present in intake.facts. A pruned angle can never be selected.
5. CONVERGE: select the non-pruned angle with the strongest profile (fact_risk counts against it). Tie-break in this order: Built for India pillar > dual audience > lower fact_risk. Explain the choice in one sentence in "why".
</thinking_procedure>

<constraints>
- Exactly 3 angles, ids "A", "B", "C" in that order.
- "selected" must be the id of a non-pruned angle.
- Do not introduce any fact that isn't already in <intake>.
</constraints>

<format>Return JSON matching the provided schema exactly. No prose outside the JSON.</format>`;
}
