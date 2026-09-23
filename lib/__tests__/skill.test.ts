import { describe, expect, it } from "vitest";
import { extractSection, loadSkillFiles } from "@/lib/skill";

describe("loadSkillFiles", () => {
  it("loads all six skill files from content/meera-voice", () => {
    const skill = loadSkillFiles();
    expect(skill.skill).toContain("MeeraVoice");
    expect(skill.linkedin.length).toBeGreaterThan(0);
    expect(skill.lexicon.length).toBeGreaterThan(0);
    expect(skill.pillars.length).toBeGreaterThan(0);
    expect(skill.brandFacts.length).toBeGreaterThan(0);
    expect(skill.newsletter.length).toBeGreaterThan(0);
  });
});

describe("extractSection", () => {
  it("extracts the Voice checklist section from SKILL.md", () => {
    const skill = loadSkillFiles();
    const section = extractSection(skill.skill, "Voice checklist (run before delivering)");
    expect(section).toContain("## Voice checklist (run before delivering)");
    expect(section).toContain("1. Does the piece close a specific label-vs-formulation gap");
    expect(section).toContain("10. Read the opening two lines alone");
    // Should not spill into the next section (there is none after it, but
    // guard against accidentally including everything from an earlier bug).
    expect(section).not.toContain("## What she never does");
  });

  it("throws for a heading that doesn't exist", () => {
    const skill = loadSkillFiles();
    expect(() => extractSection(skill.skill, "Nonexistent Section")).toThrow();
  });
});
