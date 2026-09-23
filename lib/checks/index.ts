import { findLexiconViolations } from "@/lib/checks/lexicon";
import { findSpellingViolations } from "@/lib/checks/spelling";
import { findUnsupportedNumbers } from "@/lib/checks/numbers";
import { type ChecksResult } from "@/lib/pipeline/schemas";

const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const BULLET_LINE_PATTERN = /^[ \t]*[-•][ \t]/gm;
const BOUNDING_PATTERN =
  /\b(i'm not saying|i am not saying|i'm not|i want to be precise|i want to be careful|i want to be honest)\b/gi;

const CHAR_CEILING = 2800;
const CHAR_WARN_LOW = 1200;
const CHAR_WARN_HIGH = 2200;
const HOOK_WARN_LEN = 140;

function matchesOf(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[0]);
}

/**
 * Runs every deterministic voice check against a draft. `groundingText`
 * should be the concatenation of the source fragment transcript(s) plus
 * brand-facts.md, used to catch numbers the draft states but never earned.
 */
export function computeChecks(text: string, groundingText: string): ChecksResult {
  const trimmed = text.trim();
  const charCount = trimmed.length;

  const charCountStatus: ChecksResult["char_count_status"] =
    charCount > CHAR_CEILING
      ? "fail_over_ceiling"
      : charCount > CHAR_WARN_HIGH
        ? "warn_long"
        : charCount < CHAR_WARN_LOW
          ? "warn_short"
          : "ok";

  const firstLineBreak = trimmed.indexOf("\n");
  const hookLen = firstLineBreak === -1 ? trimmed.length : firstLineBreak;
  const hookLenStatus: ChecksResult["hook_len_status"] =
    hookLen > HOOK_WARN_LEN ? "warn_long" : "ok";

  const emojiViolations = matchesOf(trimmed, EMOJI_PATTERN);
  const hashtagViolations = matchesOf(trimmed, /#/g);
  const exclamationViolations = matchesOf(trimmed, /!/g);
  const emDashViolations = matchesOf(trimmed, /—/g);
  const enDashViolations = matchesOf(trimmed, /–/g);
  const bulletViolations = matchesOf(trimmed, BULLET_LINE_PATTERN);
  const boldViolations = matchesOf(trimmed, /\*\*/g);

  const lexiconViolations = findLexiconViolations(trimmed).map((v) => ({
    term: v.term,
    index: v.index,
  }));
  const spellingViolations = findSpellingViolations(trimmed).map((v) => ({
    american: v.american,
    british: v.british,
    index: v.index,
  }));
  const unsupportedNumbers = findUnsupportedNumbers(trimmed, groundingText);

  const boundingCount = matchesOf(trimmed, BOUNDING_PATTERN).length;
  const boundingCountStatus: ChecksResult["bounding_count_status"] =
    boundingCount === 0 ? "warn_zero" : boundingCount > 2 ? "warn_many" : "ok";

  const passed =
    charCountStatus !== "fail_over_ceiling" &&
    emojiViolations.length === 0 &&
    hashtagViolations.length === 0 &&
    exclamationViolations.length === 0 &&
    emDashViolations.length === 0 &&
    enDashViolations.length === 0 &&
    bulletViolations.length === 0 &&
    boldViolations.length === 0 &&
    lexiconViolations.length === 0 &&
    spellingViolations.length === 0 &&
    unsupportedNumbers.length === 0;

  return {
    char_count: charCount,
    char_count_status: charCountStatus,
    hook_len: hookLen,
    hook_len_status: hookLenStatus,
    emoji_violations: emojiViolations,
    hashtag_violations: hashtagViolations,
    exclamation_violations: exclamationViolations,
    em_dash_violations: emDashViolations,
    en_dash_violations: enDashViolations,
    bullet_violations: bulletViolations,
    bold_violations: boldViolations,
    lexicon_violations: lexiconViolations,
    spelling_violations: spellingViolations,
    unsupported_numbers: unsupportedNumbers,
    bounding_count: boundingCount,
    bounding_count_status: boundingCountStatus,
    passed,
  };
}
