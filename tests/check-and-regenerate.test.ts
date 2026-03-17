import { describe, it, expect, vi } from "vitest";
import { checkAndRegenerate } from "@/lib/grounding";
import type { Deck, Slide } from "@/lib/schemas";

// Helper to make a slide
function makeSlide(num: number, sources: string[], grounded = true): Slide {
  return {
    slide_number: num,
    title: `Slide ${num}`,
    talking_points: ["point 1"],
    features: ["feature 1"],
    sources,
  };
}

const chunks = [
  { id: 1, content: "Credal provides audit trails", source_url: "https://docs.credal.ai/audit" },
  { id: 2, content: "Credal supports SSO", source_url: "https://docs.credal.ai/sso" },
];

describe("checkAndRegenerate", () => {
  it("returns immediately when all slides are grounded", async () => {
    const generateSlide = vi.fn();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://docs.credal.ai/audit"]),
        makeSlide(2, ["https://docs.credal.ai/sso"]),
      ],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide });
    expect(generateSlide).not.toHaveBeenCalled();
    expect(result.iterations).toBe(0);
    expect(result.deck.slides.every(s => s.grounding_status === "grounded")).toBe(true);
  });

  it("regenerates only failing slides", async () => {
    const generateSlide = vi.fn().mockResolvedValue(
      makeSlide(1, ["https://docs.credal.ai/audit"])
    );
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://not-in-chunks.com"]),  // failing
        makeSlide(2, ["https://docs.credal.ai/sso"]), // passing
      ],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide });
    expect(generateSlide).toHaveBeenCalledTimes(1);
    expect(result.deck.slides[0].sources).toContain("https://docs.credal.ai/audit");
  });

  it("returns with needs_review after exhausting attempts", async () => {
    const generateSlide = vi.fn().mockResolvedValue(
      makeSlide(1, ["https://still-bad.com"])
    );
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [makeSlide(1, ["https://not-in-chunks.com"])],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, maxAttempts: 2 });
    expect(generateSlide).toHaveBeenCalledTimes(2);
    expect(result.deck.slides[0].grounding_status).toBe("needs_review");
    expect(result.slidesFailedGrounding).toBe(1);
  });

  it("bounds calls to maxAttempts × failing slides", async () => {
    const generateSlide = vi.fn().mockImplementation(async (slide: Slide) =>
      makeSlide(slide.slide_number, ["https://still-bad.com"])
    );
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://bad1.com"]),
        makeSlide(2, ["https://bad2.com"]),
      ],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, maxAttempts: 2 });
    // 2 failing slides × 2 attempts = 4 max calls
    expect(generateSlide).toHaveBeenCalledTimes(4);
  });

  it("stops regenerating a slide once it passes", async () => {
    let callCount = 0;
    const generateSlide = vi.fn().mockImplementation(async (slide: Slide) => {
      callCount++;
      // Pass on second call for slide 1
      if (slide.slide_number === 1 && callCount >= 2) {
        return makeSlide(1, ["https://docs.credal.ai/audit"]);
      }
      return makeSlide(slide.slide_number, ["https://bad.com"]);
    });
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [makeSlide(1, ["https://bad.com"])],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, maxAttempts: 3 });
    // Should stop after it passes on attempt 2, not continue to attempt 3
    expect(generateSlide).toHaveBeenCalledTimes(2);
    expect(result.deck.slides[0].grounding_status).toBe("grounded");
  });
});
