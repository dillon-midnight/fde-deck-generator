import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeDiff } from "@/lib/diff";
import type { Deck } from "@/lib/schemas";

function makeDeck(slides: any[]): Deck {
  return { deal_id: "deal-1", company: "Acme", slides };
}

function makeSlide(num: number, title: string, points: string[] = ["p1"]) {
  return { slide_number: num, title, talking_points: points, features: ["f1"], sources: ["s1"] };
}

describe("computeDiff", () => {
  it("detects modified slides", () => {
    const original = makeDeck([makeSlide(1, "Original Title")]);
    const edited = makeDeck([makeSlide(1, "New Title")]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_modified).toContain(1);
    expect(diff.changes.length).toBeGreaterThan(0);
  });

  it("detects added slides", () => {
    const original = makeDeck([makeSlide(1, "Slide 1")]);
    const edited = makeDeck([makeSlide(1, "Slide 1"), makeSlide(2, "Slide 2")]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_added).toContain(2);
  });

  it("detects deleted slides", () => {
    const original = makeDeck([makeSlide(1, "Slide 1"), makeSlide(2, "Slide 2")]);
    const edited = makeDeck([makeSlide(1, "Slide 1")]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_deleted).toContain(2);
  });

  it("returns empty diff when no changes", () => {
    const deck = makeDeck([makeSlide(1, "Slide 1")]);
    const diff = computeDiff(deck, deck);
    expect(diff.slides_modified).toHaveLength(0);
    expect(diff.slides_added).toHaveLength(0);
    expect(diff.slides_deleted).toHaveLength(0);
    expect(diff.changes).toHaveLength(0);
  });

  it("produces correct change details shape", () => {
    const original = makeDeck([makeSlide(1, "Old", ["old point"])]);
    const edited = makeDeck([makeSlide(1, "New", ["new point"])]);
    const diff = computeDiff(original, edited);
    expect(diff.changes[0]).toHaveProperty("slide_number");
    expect(diff.changes[0]).toHaveProperty("field");
    expect(diff.changes[0]).toHaveProperty("from");
    expect(diff.changes[0]).toHaveProperty("to");
  });

  it("detects reordering", () => {
    const original = makeDeck([makeSlide(1, "A"), makeSlide(2, "B")]);
    const edited = makeDeck([makeSlide(2, "B"), makeSlide(1, "A")]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_reordered).toBe(true);
  });

  it("does not flag reorder when order preserved", () => {
    const original = makeDeck([makeSlide(1, "A"), makeSlide(2, "B")]);
    const edited = makeDeck([makeSlide(1, "A changed"), makeSlide(2, "B")]);
    const diff = computeDiff(original, edited);
    expect(diff.slides_reordered).toBe(false);
  });
});
