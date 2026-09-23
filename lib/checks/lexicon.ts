/**
 * Mirrors the "Avoid" list in content/meera-voice/references/lexicon.md.
 * Kept as a maintained array (rather than parsed from the markdown prose at
 * runtime) because the source list mixes bare words with parenthetical
 * caveats that aren't reliably machine-parseable. Update this list if that
 * file's "Avoid" section changes.
 */
export const BANNED_TERMS: string[] = [
  // Hype words
  "amazing",
  "game-changing",
  "game changing",
  "holy grail",
  "miracle",
  "glow",
  "radiant",
  "flawless",
  "obsessed",
  "must-have",
  "must have",
  "revolutionary",
  "powerhouse",
  "clinically proven",
  "skin-loving",
  "skin loving",
  "nourishing",
  "toxin",
  "chemical-free",
  "chemical free",
  "science-backed",
  "science backed",
  // Generic AI/LinkedIn structure tells
  "here's the thing",
  "let that sink in",
  "unpopular opinion",
  "read that again",
  "the result?",
  "what do you think?",
  "thoughts?",
];

export interface LexiconViolation {
  term: string;
  index: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR = /\w/;

export function findLexiconViolations(text: string): LexiconViolation[] {
  const violations: LexiconViolation[] = [];
  for (const term of BANNED_TERMS) {
    // \b only makes sense where the term's edge is itself a word character;
    // several terms end in punctuation ("thoughts?"), where \b would fail to
    // anchor and silently miss real matches.
    const leadingBoundary = WORD_CHAR.test(term[0] ?? "") ? "\\b" : "";
    const trailingBoundary = WORD_CHAR.test(term[term.length - 1] ?? "") ? "\\b" : "";
    const pattern = new RegExp(`${leadingBoundary}${escapeRegExp(term)}${trailingBoundary}`, "gi");
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      violations.push({ term, index: match.index });
    }
  }
  return violations.sort((a, b) => a.index - b.index);
}
