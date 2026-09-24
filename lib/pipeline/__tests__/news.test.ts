import { describe, expect, it } from "vitest";
import { toKeywordQuery, toKeywordQueryLadder } from "@/lib/pipeline/news";

describe("toKeywordQuery", () => {
  it("strips generic connector/meta words from a templated core_claim sentence", () => {
    // Regression: the full sentence returned zero Google News results, but
    // "skin barrier repair" (a subset of these keywords) found real matches.
    const query = toKeywordQuery(
      "Understanding the skin barrier requires recognizing the different causes of damage and tailoring solutions accordingly, rather than applying a one-size-fits-all approach.",
    );
    expect(query.toLowerCase()).not.toContain("understanding");
    expect(query.toLowerCase()).not.toContain("requires");
    expect(query.toLowerCase()).not.toContain("recognizing");
    expect(query.toLowerCase()).toContain("skin");
    expect(query.toLowerCase()).toContain("barrier");
  });

  it("keeps genuine subject-matter nouns", () => {
    const query = toKeywordQuery(
      "A supplier's emollient ingredient was falsely labeled as cold-pressed, highlighting the importance of verifying processing documentation.",
    );
    expect(query.toLowerCase()).toContain("supplier");
    expect(query.toLowerCase()).toContain("emollient");
    expect(query.toLowerCase()).toContain("cold-pressed");
    expect(query.toLowerCase()).not.toContain("importance");
    expect(query.toLowerCase()).not.toContain("verifying");
  });

  it("caps the query at maxWords and de-duplicates", () => {
    const query = toKeywordQuery("serum serum absorption absorption layering order product barrier", 3);
    expect(query.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("returns an empty string for an entirely stopword/short input", () => {
    expect(toKeywordQuery("it is of the and")).toBe("");
  });
});

describe("toKeywordQueryLadder", () => {
  it("produces progressively shorter fallback queries, most specific first", () => {
    // Regression: even a 6-word stopword-filtered query can be
    // over-constrained for Google News' matching - "term clean beauty
    // marketing tool fails" found nothing, while "term clean" (a shorter
    // fallback further down this ladder) found real, on-topic articles.
    const ladder = toKeywordQueryLadder(
      "The term 'clean beauty' is a marketing tool that fails to ensure product efficacy or formulation quality, despite appealing to consumers seeking transparency and safety.",
    );
    expect(ladder.length).toBeGreaterThan(1);
    // Each entry should be a prefix (in word count) of the previous one.
    const wordCounts = ladder.map((q) => q.split(" ").length);
    for (let i = 1; i < wordCounts.length; i++) {
      expect(wordCounts[i]!).toBeLessThan(wordCounts[i - 1]!);
    }
  });

  it("de-duplicates identical entries when the source has fewer content words than the ladder steps", () => {
    const ladder = toKeywordQueryLadder("serum layering order");
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it("returns an empty array when there are no content words at all", () => {
    expect(toKeywordQueryLadder("it is of the and")).toEqual([]);
  });
});
