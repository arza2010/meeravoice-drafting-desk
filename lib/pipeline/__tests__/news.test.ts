import { describe, expect, it } from "vitest";
import { toKeywordQuery } from "@/lib/pipeline/news";

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
