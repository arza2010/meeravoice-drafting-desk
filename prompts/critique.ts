import { extractSection, loadSkillFiles } from "@/lib/skill";
import type { ChecksResult, DraftOutput, Intake } from "@/lib/pipeline/schemas";

export interface CritiquePromptInput {
  draft: DraftOutput;
  checks: ChecksResult;
  intake: Intake;
  /** Set when this text was just produced by applying Meera's own edit instruction. */
  editInstruction?: string;
}

/** Stage 4 (critique + revise): temperature ~0.2, max 2 loops (looping happens in code). */
export function buildCritiquePrompt(input: CritiquePromptInput): string {
  const skill = loadSkillFiles();
  const checklist = extractSection(skill.skill, "Voice checklist (run before delivering)");

  return `<role>You are Meera's strictest editor. You check against her voice checklist and fix only what fails.</role>

<task>Review the draft against the deterministic check results, the 10-point voice checklist, and two additional items (11-12) below. Return a verdict per item, quoting the offending line where relevant, and a revised draft that fixes every failure with the smallest possible change.</task>

<context>
<checklist>
${checklist}

11. No named competitors and no named individuals in a critical or negative context anywhere in the text (including the hook). A named brand or person may only appear if the mention is neutral and necessary (e.g. Skinstinct itself). Every other brand or person must be described by their practice, not their name - "a booth at a trade fair", "another brand's rep", never "GlowLuxe" or similar.
12. Every specific scene, date or event asserted as something that actually happened - "last month's expo", "at a trade fair in Mumbai", "in 2021", "a customer told me" - must be traceable to a fact in <intake>, not merely plausible-sounding or in keeping with the voice. Read the hook and turn especially closely: this is the single most common place a scene gets invented to make an opening feel vivid. If a scene isn't in <intake>, it is fabricated regardless of how well it reads, and must be rewritten to describe the underlying point without asserting a specific occasion, or replaced with a scene that genuinely is in <intake> if one exists. Separately: check that every number stays paired with what it actually measured in <intake> - a real number reattached to a different claim than the one it originally supported (e.g. a return-rate figure restated as a claim about something else) is fabrication even though the digits are accurate, and fails this item too.
</checklist>

<checks>
${JSON.stringify(input.checks, null, 2)}
</checks>

<draft>
${JSON.stringify(input.draft, null, 2)}
</draft>

<intake>
${JSON.stringify(input.intake, null, 2)}
</intake>
</context>

<constraints>
- Deterministic failures listed in <checks> are not negotiable; your revised_text must fix every one of them (remove emoji/hashtags/exclamation marks/em or en dashes/bullets/bold, replace every American spelling and banned lexicon term, resolve every unsupported number).
- Never add a new fact, number, name, or specific while revising - only use facts already present in <draft> or <intake>. This holds even when it means checklist item 5 (three or more concrete numbers) does not fully pass: a vague-but-honest line that stays vague, or an explicit "[NUMBER NEEDED: ...]" / "[NEEDS VERIFICATION: ...]" placeholder, is always the correct fix for a missing specific. Inventing a number, a study, a lab name, or any other specific to make the checklist look better is a worse failure than leaving item 5 failing, because it puts a fabricated claim in front of Meera's audience.
- If a deterministic failure can only be fixed by removing an unsupported claim, remove or placeholder it rather than inventing a source for it.
- Do not lengthen the post past 2,200 characters; if it's already over, cut rather than add.
- items must cover all 12 items above in order (n = 1 through 12), each with pass (boolean), quote (the specific offending text, or null if it passes), and fix (what you changed or would change, or null if it passes).
- Fixing item 12 never means inventing a source for the scene - it means removing the specific occasion claim while keeping the underlying point, or falling back to a scene that genuinely is in <intake>.
- remaining_flags lists anything you could not fully resolve without more information from Meera (e.g. a placeholder that still needs a real number) - use plain language, one flag per line.
${
  input.editInstruction
    ? `- This text was just produced by applying Meera's own instruction, verbatim: "${input.editInstruction}". Respect that instruction as intentional, including if it made the piece shorter or removed a section. Do not add length, reintroduce removed content, or add new specifics merely to satisfy checklist items 5 (concrete numbers) or 9 (length within range) - those items may legitimately fail here and that is fine. Only fix genuine mechanical/deterministic violations and clear items 6, 7, 10, 11 and 12.`
    : ""
}
</constraints>

<format>Return JSON matching the provided schema exactly: {items, revised_text, remaining_flags}. No prose outside the JSON.</format>`;
}
