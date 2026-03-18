import { describe, it, expect } from "vitest";
import { computeDiff } from "@/lib/diff";
import type { Deck } from "@/lib/schemas";

function makeDeck(slides: Deck["slides"]): Deck {
  return { deal_id: "deal-1", company: "Acme", slides };
}

function makeSlide(num: number, overrides: Record<string, unknown> = {}) {
  return {
    slide_number: num,
    title: `Slide ${num}`,
    talking_points: ["point 1"],
    features: ["feature 1"],
    sources: ["https://docs.credal.ai/test"],
    ...overrides,
  };
}

describe("deck retrieval and eval integration", () => {
  it("diff handles deck without eval (no changes)", () => {
    const deck = makeDeck([makeSlide(1), makeSlide(2)]);
    const diff = computeDiff(deck, deck);
    expect(diff.slides_modified).toHaveLength(0);
    expect(diff.slides_added).toHaveLength(0);
    expect(diff.slides_deleted).toHaveLength(0);
  });

  it("diff handles deck with eval (with changes)", () => {
    const original = makeDeck([makeSlide(1), makeSlide(2)]);
    const edited = makeDeck([
      makeSlide(1, { title: "Updated Title", talking_points: ["new point"] }),
      makeSlide(2),
    ]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_modified).toContain(1);
    expect(diff.slides_modified).not.toContain(2);
  });

  it("diff detects feature changes", () => {
    const original = makeDeck([makeSlide(1)]);
    const edited = makeDeck([makeSlide(1, { features: ["new feature"] })]);
    const diff = computeDiff(original, edited);
    expect(diff.changes.some(c => c.field === "features")).toBe(true);
  });

  it("diff detects source changes", () => {
    const original = makeDeck([makeSlide(1)]);
    const edited = makeDeck([makeSlide(1, { sources: ["https://new-source.com"] })]);
    const diff = computeDiff(original, edited);
    expect(diff.changes.some(c => c.field === "sources")).toBe(true);
  });

  it("diff handles complete slide replacement", () => {
    const original = makeDeck([makeSlide(1), makeSlide(2)]);
    const edited = makeDeck([makeSlide(3), makeSlide(4)]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_deleted).toEqual(expect.arrayContaining([1, 2]));
    expect(diff.slides_added).toEqual(expect.arrayContaining([3, 4]));
  });
});
