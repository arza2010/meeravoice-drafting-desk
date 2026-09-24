import { loadSkillFiles } from "@/lib/skill";
import type { Intake } from "@/lib/pipeline/schemas";
import type { RecentPostSummary } from "@/prompts/types";

export interface AnglesPromptInput {
  intake: Intake;
  recentPosts: RecentPostSummary[];
  meeraFeedback: string[];
  /** Unverified, best-effort Google News RSS context - see lib/pipeline/news.ts. */
  newsContext?: string | null;
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

<recent_context source="Google News RSS search, real headlines but relevance and content not verified">
${input.newsContext ?? "(no current-events context available for this fragment)"}
</recent_context>
</context>

<thinking_procedure>
1. BRANCH: Produce 3 angles (ids "A", "B", "C") that differ from each other in at least two of: pillar, hook_type (label_reversal | dated_scene | hard_data | industry_moment), audience (consumer | operator | dual). IMPORTANT: hook_type "dated_scene" or "industry_moment" is only allowed if intake.facts already contains a genuine scene, date, or event (something Meera actually described happening - a meeting, a trade fair, a conversation, a specific day). If intake.facts has no such scene, do not use either of those two hook_types for any angle - invent nothing to fill the category. It is entirely fine for all 3 angles to use label_reversal and/or hard_data instead when that's all the material supports.
2. For each angle, write: the hook (aim for under 140 characters; every specific claim in it - a number, a place, a date, an event, a verbatim label claim - must be traceable near-verbatim to an entry in intake.facts, not merely "plausible" or "the kind of thing that could happen"), the gap it closes, the reader test, and depends_on_facts listing exactly which intake facts (verbatim or close to it) it relies on - depends_on_facts must include every fact the hook itself asserts, not just the ones that are convenient to admit to.
3. EVALUATE each angle 1-5 on: gap_clarity, specificity_available (score high only for facts that are actually present in intake.facts), dual_audience (fit for LinkedIn's dual consumer/operator readership), voice_fit, fact_risk (1 = low risk of an unsupported claim - score this honestly against what's actually verifiable, not against how confident the hook sounds), novelty (penalise an angle whose pillar+hook_type combination matches either of the last 2 recent_posts).
4. PRUNE: set pruned=true with a prune_reason for any angle that depends on a fact not present in intake.facts - check this against the hook's actual content, not just against what depends_on_facts claims, since a hook can assert something its own depends_on_facts list quietly omits. A pruned angle can never be selected.
5. CONVERGE: select the non-pruned angle with the strongest profile (fact_risk counts against it). Tie-break in this order: Built for India pillar > dual audience > lower fact_risk. Explain the choice in one sentence in "why".
</thinking_procedure>

<constraints>
- Exactly 3 angles, ids "A", "B", "C" in that order.
- "selected" must be the id of a non-pruned angle.
- Do not introduce any fact that isn't already in <intake>. This includes scenes, dates and events: never invent "last month's expo", "a recent conversation", "at a conference" or similar to manufacture a dated_scene/industry_moment hook - if intake.facts doesn't hand you a real one, don't write one.
- A number stays paired with what it actually measures. If intake.facts has "23% of returns cited texture/feel complaints", you may state exactly that - you may NOT restate it as "23% of returns came from layering errors" or "23% of customers don't realise X" or any other claim that reuses the number for a different assertion than the one it was actually attached to in intake.facts. A real number bolted onto an invented claim is fabrication, not a lesser version of it - it is not made safer by being numerically accurate.
- <recent_context> is optional and unverified. You may let it inform which angle feels timely, and an angle may reference its general theme (e.g. "renewed attention this month to X") in the hook or gap - but depends_on_facts must still list only facts from <intake>; a theme drawn from <recent_context> is not a "fact" and any specific number, study, or named source in it must be treated as needing verification later, never asserted outright. If nothing in <recent_context> is genuinely relevant, ignore it entirely rather than forcing a connection. <recent_context> is also never itself the "genuine scene" that licenses a dated_scene/industry_moment hook_type - that licence comes only from intake.facts.
</constraints>

<format>Return JSON matching the provided schema exactly. No prose outside the JSON.</format>`;
}
