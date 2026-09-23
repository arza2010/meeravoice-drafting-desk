import { describe, expect, it } from "vitest";
import { computeChecks } from "@/lib/checks";

const GROUNDING = "Our serum pH is 5.5-5.8 and we document it on every batch. Returns dropped to 8%.";

function cleanDraft(body: string): string {
  return `A clean hook line.\n\n${body}\n\nI'm not saying this is the whole story. I'm saying it's useful information.`;
}

describe("computeChecks: char_count", () => {
  it("passes a mid-length draft", () => {
    const text = cleanDraft("x".repeat(1400));
    const result = computeChecks(text, GROUNDING);
    expect(result.char_count_status).toBe("ok");
  });

  it("warns short under 1200 chars", () => {
    const result = computeChecks("Short hook.\n\nToo short overall.", GROUNDING);
    expect(result.char_count_status).toBe("warn_short");
  });

  it("warns long over 2200 chars", () => {
    const text = cleanDraft("x".repeat(2150));
    const result = computeChecks(text, GROUNDING);
    expect(result.char_count_status).toBe("warn_long");
  });

  it("fails over the 2800 ceiling", () => {
    const text = cleanDraft("x".repeat(2800));
    const result = computeChecks(text, GROUNDING);
    expect(result.char_count_status).toBe("fail_over_ceiling");
    expect(result.passed).toBe(false);
  });
});

describe("computeChecks: hook_len", () => {
  it("is ok under 140 chars before the first line break", () => {
    const result = computeChecks("Short hook.\n\nBody text here that is long enough to pad things out a little more than usual for testing purposes truly.", GROUNDING);
    expect(result.hook_len_status).toBe("ok");
  });

  it("warns when the hook exceeds 140 chars", () => {
    const longHook = "H".repeat(150);
    const result = computeChecks(`${longHook}\n\nBody.`, GROUNDING);
    expect(result.hook_len).toBe(150);
    expect(result.hook_len_status).toBe("warn_long");
  });
});

describe("computeChecks: zero-match mechanics", () => {
  it("flags emoji", () => {
    const result = computeChecks(cleanDraft("This is great 🎉"), GROUNDING);
    expect(result.emoji_violations.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });

  it("flags hashtags", () => {
    const result = computeChecks(cleanDraft("Check out #skincare"), GROUNDING);
    expect(result.hashtag_violations).toEqual(["#"]);
    expect(result.passed).toBe(false);
  });

  it("flags exclamation marks", () => {
    const result = computeChecks(cleanDraft("This matters!"), GROUNDING);
    expect(result.exclamation_violations).toEqual(["!"]);
    expect(result.passed).toBe(false);
  });

  it("flags em dashes", () => {
    const result = computeChecks(cleanDraft("A claim — and a caveat."), GROUNDING);
    expect(result.em_dash_violations).toEqual(["—"]);
    expect(result.passed).toBe(false);
  });

  it("flags en dashes", () => {
    const result = computeChecks(cleanDraft("A claim – and a caveat."), GROUNDING);
    expect(result.en_dash_violations).toEqual(["–"]);
    expect(result.passed).toBe(false);
  });

  it("flags leading bullet lines", () => {
    const result = computeChecks(cleanDraft("- first point\n- second point"), GROUNDING);
    expect(result.bullet_violations.length).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("flags bold markers", () => {
    const result = computeChecks(cleanDraft("This is **important**."), GROUNDING);
    expect(result.bold_violations).toEqual(["**", "**"]);
    expect(result.passed).toBe(false);
  });

  it("allows a spaced hyphen as the dash", () => {
    const result = computeChecks(cleanDraft("A claim - and a caveat."), GROUNDING);
    expect(result.em_dash_violations).toEqual([]);
    expect(result.en_dash_violations).toEqual([]);
  });
});

describe("computeChecks: lexicon", () => {
  it("flags a banned hype word", () => {
    const result = computeChecks(cleanDraft("This product is truly amazing."), GROUNDING);
    expect(result.lexicon_violations.some((v) => v.term === "amazing")).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("flags a generic AI structure tell", () => {
    const result = computeChecks(cleanDraft("Here's the thing: it works."), GROUNDING);
    expect(result.lexicon_violations.some((v) => v.term === "here's the thing")).toBe(true);
  });

  it("passes clean vocabulary", () => {
    const result = computeChecks(cleanDraft("This is a precise, documented formulation claim."), GROUNDING);
    expect(result.lexicon_violations).toEqual([]);
  });
});

describe("computeChecks: spelling", () => {
  it("flags American spellings", () => {
    const result = computeChecks(cleanDraft("The moisturizer helps stabilize the formula's color."), GROUNDING);
    const words = result.spelling_violations.map((v) => v.american.toLowerCase());
    expect(words).toContain("moisturizer");
    expect(words).toContain("stabilize");
    expect(words).toContain("color");
    expect(result.passed).toBe(false);
  });

  it("passes British spellings", () => {
    const result = computeChecks(cleanDraft("The moisturiser helps stabilise the formula's colour."), GROUNDING);
    expect(result.spelling_violations).toEqual([]);
  });
});

describe("computeChecks: unsupported numbers", () => {
  it("passes a number that appears in the grounding text", () => {
    const result = computeChecks(cleanDraft("Our serum pH is 5.5-5.8, documented every batch."), GROUNDING);
    expect(result.unsupported_numbers).toEqual([]);
  });

  it("flags a number with no source", () => {
    const result = computeChecks(cleanDraft("Studies show a 40% improvement in outcomes."), GROUNDING);
    expect(result.unsupported_numbers.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });

  it("does not flag a number inside a placeholder", () => {
    const result = computeChecks(
      cleanDraft("The return rate improved by [NUMBER NEEDED: humid-city return rate change]."),
      GROUNDING,
    );
    expect(result.unsupported_numbers).toEqual([]);
  });

  it("does not let a bare number falsely match inside an unrelated percentage in the grounding text", () => {
    // Regression: grounding text containing "50% ceramides" must not make a
    // fabricated "sample size of 50" look supported.
    const grounding = "Ceramide ratio is around 50% ceramides, 25% cholesterol, 15% fatty acids.";
    const result = computeChecks(cleanDraft("Sample size of 50, double-blind study."), grounding);
    expect(result.unsupported_numbers).toContain("50");
    expect(result.passed).toBe(false);
  });

  it("does not let a short number falsely match inside a longer unrelated number", () => {
    const grounding = "We reformulated in 2021 with a new base.";
    const result = computeChecks(cleanDraft("A study from 21 found strong results."), grounding);
    expect(result.unsupported_numbers).toContain("21");
  });
});

describe("computeChecks: bounding_count", () => {
  it("warns when there is no bounding line", () => {
    const result = computeChecks("Hook.\n\nJust a plain body with no bounding line at all in it here.", GROUNDING);
    expect(result.bounding_count).toBe(0);
    expect(result.bounding_count_status).toBe("warn_zero");
  });

  it("counts exactly one bounding line as ok", () => {
    const result = computeChecks(
      "Hook.\n\nBody.\n\nI'm not saying this proves everything, only that it's worth checking.",
      GROUNDING,
    );
    expect(result.bounding_count).toBe(1);
    expect(result.bounding_count_status).toBe("ok");
  });

  it("warns when there are more than two bounding lines", () => {
    const text =
      "Hook.\n\nI want to be precise here. I want to be careful there. I want to be honest about the third thing.";
    const result = computeChecks(text, GROUNDING);
    expect(result.bounding_count).toBe(3);
    expect(result.bounding_count_status).toBe("warn_many");
  });
});

describe("computeChecks: passed", () => {
  it("is true for a fully clean draft grounded in the transcript", () => {
    const text =
      "A precise hook about pH.\n\nOur serum pH is 5.5-5.8, documented on every batch.\n\nI'm not saying every brand needs to publish this, only that it's worth asking for.";
    const result = computeChecks(text, GROUNDING);
    expect(result.passed).toBe(true);
  });
});
