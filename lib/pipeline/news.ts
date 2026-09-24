import { XMLParser } from "fast-xml-parser";
import type { Intake } from "@/lib/pipeline/schemas";

const GOOGLE_NEWS_TIMEOUT_MS = 8000;
const MAX_ITEMS = 3;

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string | null;
}

export interface RunNewsContextResult {
  /** Rendered for the angle/draft prompts - see prompts/angles.ts and prompts/draft.ts. */
  context: string | null;
  /** Structured items, so delivery can show Meera the real source links directly. */
  items: NewsItem[];
}

// A general-purpose stopword list (not tuned to any specific example) used
// to turn a full sentence into a short keyword query. Google News RSS search
// matches keywords, not natural language - a full sentence like
// "Understanding the skin barrier requires recognizing the different causes
// of damage..." reliably returns zero results even when short, on-topic
// coverage exists (verified: "skin barrier repair" alone found a match that
// the full sentence didn't).
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "and", "or",
  "but", "that", "this", "these", "those", "for", "on", "in", "at", "by", "with", "from", "as",
  "it", "its", "rather", "than", "not", "no", "so", "if", "then", "because", "while", "when",
  "where", "which", "who", "whom", "how", "what", "why", "can", "could", "should", "would",
  "will", "shall", "may", "might", "must", "do", "does", "did", "doing", "have", "has", "had",
  "having", "i", "you", "he", "she", "we", "they", "them", "their", "our", "your", "my", "his",
  "her", "also", "just", "very", "more", "most", "some", "any", "all", "each", "every", "other",
  "such", "only", "own", "same", "too", "after", "before", "again", "further", "once", "here",
  "there", "up", "down", "out", "off", "over", "under", "about", "into", "through", "during",
  // intake.core_claim is itself LLM-generated and tends to follow a small
  // set of templated constructions ("Understanding X requires Y",
  // "highlighting the importance of Z") - these connector/meta words carry
  // no topical signal and crowd out the actual subject if not filtered.
  "understanding", "understand", "requires", "require", "requiring", "recognizing", "recognize",
  "applying", "apply", "tailoring", "tailor", "highlighting", "highlights", "verifying", "verify",
  "importance", "important", "different", "solutions", "solution", "approach", "approaches",
  "causes", "cause", "affects", "affect", "affecting", "involves", "involve", "involving",
]);

function contentWords(text: string): string[] {
  const words = text
    .replace(/[.,;:!?'"()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(w);
  }
  return deduped;
}

/** Reduces a full-sentence claim to a short keyword query for Google News search. */
export function toKeywordQuery(text: string, maxWords = 6): string {
  return contentWords(text).slice(0, maxWords).join(" ");
}

/**
 * A ladder of candidate queries, most-specific first: even after stopword
 * removal, a 6-word query can still be over-constrained for Google News'
 * matching (verified: "term clean beauty marketing tool fails" found
 * nothing, while "clean beauty" alone found several directly relevant
 * articles). Each successive query drops words from the end, so the
 * caller can fall back to a shorter, less specific search when the
 * longer one comes up empty.
 */
export function toKeywordQueryLadder(text: string): string[] {
  const words = contentWords(text);
  const lengths = [6, 4, 2];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const len of lengths) {
    const query = words.slice(0, len).join(" ");
    if (query && !seen.has(query)) {
      seen.add(query);
      queries.push(query);
    }
  }
  return queries;
}

function extractSourceName(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "object" && raw !== null && "#text" in raw) {
    const text = (raw as Record<string, unknown>)["#text"];
    return typeof text === "string" ? text.trim() || null : null;
  }
  return null;
}

async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_NEWS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];

    const xml = await res.text();
    const parser = new XMLParser();
    const parsed: unknown = parser.parse(xml);

    const rawItems = (parsed as { rss?: { channel?: { item?: unknown } } })?.rss?.channel?.item;
    const itemArray: unknown[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    return itemArray
      .slice(0, MAX_ITEMS)
      .map((raw): NewsItem => {
        const it = raw as Record<string, unknown>;
        const rawTitle = typeof it.title === "string" ? it.title.trim() : "";
        const source = extractSourceName(it.source);
        // Google News RSS titles are conventionally "Headline - Source Name";
        // strip that suffix when it duplicates the separate <source> tag.
        const title =
          source && rawTitle.endsWith(` - ${source}`)
            ? rawTitle.slice(0, -(source.length + 3)).trim()
            : rawTitle;
        return {
          title,
          link: typeof it.link === "string" ? it.link.trim() : "",
          pubDate: typeof it.pubDate === "string" ? it.pubDate.trim() : "",
          source,
        };
      })
      .filter((it) => it.title.length > 0 && it.link.length > 0);
  } catch {
    // Best-effort: a timeout, network error, or unparseable feed for this
    // one query in the ladder should just move on to the next, not fail
    // the whole lookup.
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Google News RSS search - free, no API key, and the results are literal
 * real headlines/links rather than LLM-synthesized prose, so there's no
 * hallucination surface in the lookup itself (unlike an LLM web-search
 * tool, which can paraphrase or misattribute). Relevance filtering still
 * happens downstream in the angle/draft prompts, which are explicit that
 * this is unverified, best-effort context - see lib/pipeline/run.ts.
 *
 * Tries a ladder of queries from most to least specific (see
 * toKeywordQueryLadder) and stops at the first that returns anything,
 * since even a stopword-filtered query can still be over-constrained for
 * Google's matching.
 */
export async function runNewsContext(intake: Intake): Promise<RunNewsContextResult> {
  const queries = toKeywordQueryLadder(intake.core_claim);

  for (const query of queries) {
    const items = await fetchGoogleNewsRss(query);
    if (items.length > 0) {
      const context = items
        .map((it) => `- ${it.title}${it.source ? ` (${it.source})` : ""}${it.pubDate ? `, ${it.pubDate}` : ""}\n  ${it.link}`)
        .join("\n");
      return { context, items };
    }
  }

  return { context: null, items: [] };
}
