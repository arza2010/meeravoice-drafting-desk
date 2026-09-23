import { loadSkillFiles } from "@/lib/skill";
import { selectExemplars } from "@/lib/corpus";
import type { Angle, Intake } from "@/lib/pipeline/schemas";

export interface DraftPromptInput {
  intake: Intake;
  angle: Angle;
  /** Unverified, best-effort web-search context - see lib/pipeline/news.ts. */
  newsContext?: string | null;
}

/** Stage 3 (draft): Chain of Thought, temperature ~0.5. */
export function buildDraftPrompt(input: DraftPromptInput): string {
  const skill = loadSkillFiles();
  const exemplars = selectExemplars(input.angle.pillar, 2);
  const exemplarsBlock = exemplars
    .map(
      (e, i) =>
        `<exemplar index="${i + 1}" id="${e.id}" format="${e.format}" pillar="${e.pillar}">\n${e.text}\n</exemplar>`,
    )
    .join("\n\n");

  return `<role>You are writing as Meera Pillai. You follow the MeeraVoice skill exactly.</role>

<task>Write one LinkedIn post from the selected angle.</task>

<context>
<voice_rules>
${skill.skill}
</voice_rules>

<linkedin_structure>
${skill.linkedin}
</linkedin_structure>

<lexicon>
${skill.lexicon}
</lexicon>

<brand_facts>
${skill.brandFacts}
</brand_facts>

<angle>
${JSON.stringify(input.angle, null, 2)}
</angle>

<intake>
${JSON.stringify(input.intake, null, 2)}
</intake>

<exemplars>
${exemplarsBlock}
</exemplars>

<recent_context source="web_search, unverified">
${input.newsContext ?? "(no current-events context available for this fragment)"}
</recent_context>
</context>

<thinking_procedure>
Fill the plan fields IN ORDER before writing prose:
1. hook (aim for under 140 characters, must contain a number/place/date/verbatim label claim from the angle or intake)
2. turn (what's really going on beneath the surface; may use the three-beat deflation once)
3. mechanism: exactly 3 parts, walked through in prose sequence ("The first thing... The second thing... The third thing...")
4. bounding (exactly one "I'm not saying X. I'm saying Y." style line)
5. skinstinct_line (disclosure of stake or a self-implicating admission, framed as documentation/practice not benefit; null if genuinely irrelevant to this angle; 1-2 sentences)
6. reader_test (a question to ask any brand, plus how to read the answer)
7. close (short, flat, understated - never inspirational)

Then write "text": the full post assembled from the plan, in short paragraphs of 1-3 sentences separated by blank lines, per <linkedin_structure>.

Then list every fact actually used in "facts_used", each tagged with its source exactly as it appears in <intake>.
</thinking_procedure>

<constraints>
- Target 1,500-2,200 characters; up to 2,800 is allowed only if every paragraph carries a new fact. 2,800 is the absolute ceiling. Count characters yourself.
- British spelling throughout (moisturiser, oxidise, colour, sensitisation, standardised, programme, ...).
- Use a spaced hyphen " - " as the dash. Never an em dash "—" or an en dash "–" used as a dash.
- Zero emoji, hashtags "#", exclamation marks "!", bullets ("- " or "• " at a line start), or bold ("**").
- Any fact you need but that isn't in <intake> or <brand_facts> becomes a visible placeholder: "[NUMBER NEEDED: what it measures]" or "[NEEDS VERIFICATION: the claim]". Never invent it.
- <recent_context> may only be used for general, unattributed framing - e.g. noting that a topic has been getting attention lately - never as a source of a specific number, statistic, study, or named claim. If you do reference something specific from it, it becomes a "[NEEDS VERIFICATION: the claim]" placeholder like anything else unsourced; it is never stated as settled fact, and never attributed to Meera or Skinstinct. If nothing in it is genuinely relevant to this angle, don't mention it at all - a forced "in the news" reference reads as generic AI copy, which is exactly what she doesn't sound like.
- Never state anything listed under "Inconsistencies to confirm" in <brand_facts> as settled fact.
- No named competitors or named people in a critical context, anywhere in the piece including the hook. If the source material names a specific brand or person (e.g. a booth, a rep, a company), replace the name with a neutral description of the practice or scene ("a booth at a trade fair", "the brand's representative") even when the real name would make the hook more vivid or specific.
- No medical claims or diagnosis; these are cosmetics.
- Do not copy sentences from <exemplars> - study the structural moves (hook type, deflation, bounding, self-implication), not the wording.
- Avoid every term listed under "Avoid" in <lexicon>, and every generic AI/LinkedIn structure tell listed there.
</constraints>

<format>Return JSON matching the provided schema exactly: {plan, text, facts_used, placeholders}. No prose outside the JSON.</format>`;
}
