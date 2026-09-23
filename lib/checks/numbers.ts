const PLACEHOLDER_PATTERN = /\[(NUMBER NEEDED|NEEDS VERIFICATION):[^\]]*\]/g;

// Ordered so the most specific pattern (pH range/value) is tried before the
// generic range, then percent, then a bare number - regex alternation tries
// left-to-right at each position, so order determines which alternative
// "claims" a given span first.
const NUMBER_PATTERN =
  /\bpH\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\b|\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?%?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?/gi;

interface Span {
  start: number;
  end: number;
}

function placeholderSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function isWithin(index: number, spans: Span[]): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

function normalize(token: string): string {
  return token.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface NumberToken {
  token: string;
  index: number;
}

/** Every `[NUMBER NEEDED: ...]` / `[NEEDS VERIFICATION: ...]` placeholder in `text`, in order. */
export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[0]);
}

/** Every numeric token in `text` that is not already inside a placeholder bracket. */
export function extractNumericTokens(text: string): NumberToken[] {
  const placeholders = placeholderSpans(text);
  const tokens: NumberToken[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    if (match.index === undefined) continue;
    if (isWithin(match.index, placeholders)) continue;
    tokens.push({ token: match[0], index: match.index });
  }
  return tokens;
}

/**
 * Whether `token` appears in `grounding` as itself, not as a substring of a
 * longer, unrelated number - e.g. bare "50" must not match inside "50%", and
 * "5" must not match inside "150" or "5.5". Scans every occurrence, since an
 * early occurrence can fail the boundary check while a later one passes.
 */
function tokenAppearsInGrounding(token: string, grounding: string): boolean {
  const tokenEndsWithPercent = token.endsWith("%");
  let searchFrom = 0;
  while (true) {
    const idx = grounding.indexOf(token, searchFrom);
    if (idx === -1) return false;
    const before = grounding[idx - 1];
    const after = grounding[idx + token.length];
    const beforeOk = !before || !/[\d.]/.test(before);
    const afterOk = !after || (!/[\d.]/.test(after) && (tokenEndsWithPercent || after !== "%"));
    if (beforeOk && afterOk) return true;
    searchFrom = idx + 1;
  }
}

/**
 * Numeric tokens in `text` that don't appear (as itself, not merely as a
 * substring of some other number) anywhere in `groundingText` - i.e. the
 * transcript(s) plus brand-facts.md. These are flagged for the critique
 * stage; they are not auto-rejected, since a false positive here is still
 * possible and the critique stage has full context to judge it.
 */
export function findUnsupportedNumbers(text: string, groundingText: string): string[] {
  const grounding = normalize(groundingText);
  const tokens = extractNumericTokens(text);
  const unsupported = new Set<string>();
  for (const { token } of tokens) {
    const normalized = normalize(token);
    if (normalized.length === 0) continue;
    if (!tokenAppearsInGrounding(normalized, grounding)) {
      unsupported.add(token.trim());
    }
  }
  return [...unsupported];
}
