import fs from "node:fs";
import path from "node:path";

export interface SkillFiles {
  skill: string;
  linkedin: string;
  lexicon: string;
  pillars: string;
  brandFacts: string;
  newsletter: string;
}

let cached: SkillFiles | undefined;

function readSkillFile(relPath: string): string {
  const filePath = path.join(process.cwd(), "content", "meera-voice", relPath);
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Loads the MeeraVoice skill files verbatim from /content/meera-voice. These
 * are the source of truth for voice, structure and brand facts - runtime
 * prompts compose these files directly rather than paraphrasing them.
 */
export function loadSkillFiles(): SkillFiles {
  if (cached) return cached;
  cached = {
    skill: readSkillFile("SKILL.md"),
    linkedin: readSkillFile("references/linkedin.md"),
    lexicon: readSkillFile("references/lexicon.md"),
    pillars: readSkillFile("references/pillars.md"),
    brandFacts: readSkillFile("references/brand-facts.md"),
    newsletter: readSkillFile("references/newsletter.md"),
  };
  return cached;
}

/**
 * Extracts one "## Heading" section (verbatim, including the heading line)
 * from a markdown file's contents, up to the next "## " heading or EOF. Used
 * to pull just SKILL.md's "Voice checklist" section into the critique
 * prompt instead of the whole file.
 */
export function extractSection(markdown: string, headingText: string): string {
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex(
    (line) => line.startsWith("## ") && line.slice(3).trim() === headingText,
  );
  if (startIndex === -1) {
    throw new Error(`Section "${headingText}" not found in skill file`);
  }
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => line.startsWith("## "));
  const sectionLines = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return [lines[startIndex], ...sectionLines].join("\n").trim();
}
