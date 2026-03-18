import { describe, it, expect } from "vitest";
import { DeckSchema } from "../src/lib/schemas";
import financialDeck from "./fixtures/financial-services-deck.json";
import healthcareDeck from "./fixtures/healthcare-deck.json";

describe("fixture: financial-services-deck", () => {
  it("passes DeckSchema.parse()", () => {
    expect(() => DeckSchema.parse(financialDeck)).not.toThrow();
  });

  it("has faithfulness_rate >= 0.8", () => {
    const deck = DeckSchema.parse(financialDeck);
    const grounded = deck.slides.filter((s) => s.grounding_status === "grounded").length;
    const rate = grounded / deck.slides.length;
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  it("no slide has empty talking_points or sources", () => {
    const deck = DeckSchema.parse(financialDeck);
    for (const slide of deck.slides) {
      expect(slide.talking_points.length).toBeGreaterThan(0);
      expect(slide.sources.length).toBeGreaterThan(0);
    }
  });

  it("all source URLs match https?://", () => {
    const deck = DeckSchema.parse(financialDeck);
    for (const slide of deck.slides) {
      for (const source of slide.sources) {
        expect(source).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("fixture: healthcare-deck", () => {
  it("passes DeckSchema.parse()", () => {
    expect(() => DeckSchema.parse(healthcareDeck)).not.toThrow();
  });

  it("has faithfulness_rate >= 0.8", () => {
    const deck = DeckSchema.parse(healthcareDeck);
    const grounded = deck.slides.filter((s) => s.grounding_status === "grounded").length;
    const rate = grounded / deck.slides.length;
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  it("no slide has empty talking_points or sources", () => {
    const deck = DeckSchema.parse(healthcareDeck);
    for (const slide of deck.slides) {
      expect(slide.talking_points.length).toBeGreaterThan(0);
      expect(slide.sources.length).toBeGreaterThan(0);
    }
  });

  it("all source URLs match https?://", () => {
    const deck = DeckSchema.parse(healthcareDeck);
    for (const slide of deck.slides) {
      for (const source of slide.sources) {
        expect(source).toMatch(/^https?:\/\//);
      }
    }
  });
});
