import { describe, it, expect, vi } from "vitest";
import { checkAndRegenerate } from "@/lib/grounding";
import type { Deck, Slide } from "@/lib/schemas";

// Helper to make a slide
function makeSlide(num: number, sources: string[]): Slide {
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

// Default evaluateSlides mock that marks all slides as grounded
function allGrounded() {
  return vi.fn().mockImplementation(async (slides: Slide[]) =>
    slides.map((s) => ({ slide_number: s.slide_number, grounded: true, reason: "supported" }))
  );
}

// evaluateSlides mock that marks all slides as ungrounded
function allUngrounded() {
  return vi.fn().mockImplementation(async (slides: Slide[]) =>
    slides.map((s) => ({ slide_number: s.slide_number, grounded: false, reason: "unsupported" }))
  );
}

describe("checkAndRegenerate", () => {
  it("returns immediately when all slides are grounded", async () => {
    const generateSlide = vi.fn();
    const evaluateSlides = allGrounded();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://docs.credal.ai/audit"]),
        makeSlide(2, ["https://docs.credal.ai/sso"]),
      ],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides });
    expect(generateSlide).not.toHaveBeenCalled();
    expect(result.iterations).toBe(0);
    expect(result.deck.slides.every(s => s.grounding_status === "grounded")).toBe(true);
  });

  it("regenerates only the slide that fails LLM evaluation", async () => {
    const generateSlide = vi.fn().mockResolvedValue(
      makeSlide(1, ["https://docs.credal.ai/audit"])
    );
    const evaluateSlides = vi.fn()
      .mockImplementationOnce(async (slides: Slide[]) =>
        slides.map((s) => ({
          slide_number: s.slide_number,
          grounded: s.slide_number !== 1,
          reason: s.slide_number === 1 ? "unsupported" : "supported",
        }))
      )
      .mockImplementation(async (slides: Slide[]) =>
        slides.map((s) => ({ slide_number: s.slide_number, grounded: true, reason: "supported" }))
      );
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://docs.credal.ai/audit"]),
        makeSlide(2, ["https://docs.credal.ai/sso"]),
      ],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides });
    expect(generateSlide).toHaveBeenCalledTimes(1);
    // Verify only slide 1 was passed to generateSlide, not slide 2
    expect(generateSlide.mock.calls[0][0].slide_number).toBe(1);
    expect(result.deck.slides[0].sources).toContain("https://docs.credal.ai/audit");
    expect(result.deck.slides[1].grounding_status).toBe("grounded");
  });

  it("skips LLM evaluation and fails slides with no matching chunk URL", async () => {
    const generateSlide = vi.fn().mockResolvedValue(
      makeSlide(1, ["https://docs.credal.ai/audit"])
    );
    const evaluateSlides = allGrounded();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://not-in-chunks.com"]),  // bad URL — fails pre-filter
        makeSlide(2, ["https://docs.credal.ai/sso"]), // good URL — passes
      ],
    };
    await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides });
    // Slide 1 failed URL pre-filter, so generateSlide was called for it
    expect(generateSlide).toHaveBeenCalledTimes(1);
    expect(generateSlide.mock.calls[0][0].slide_number).toBe(1);
    // evaluateSlides should only have been called with slide 2 (the URL-passing one)
    // on the first iteration
    const firstEvalCall = evaluateSlides.mock.calls[0][0] as Slide[];
    expect(firstEvalCall.length).toBe(1);
    expect(firstEvalCall[0].slide_number).toBe(2);
  });

  it("returns with needs_review after exhausting attempts", async () => {
    const generateSlide = vi.fn().mockResolvedValue(
      makeSlide(1, ["https://docs.credal.ai/audit"])
    );
    const evaluateSlides = allUngrounded();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [makeSlide(1, ["https://docs.credal.ai/audit"])],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides, maxAttempts: 2 });
    expect(generateSlide).toHaveBeenCalledTimes(2);
    expect(result.deck.slides[0].grounding_status).toBe("needs_review");
    expect(result.slidesFailedGrounding).toBe(1);
  });

  it("bounds calls to maxAttempts × failing slides", async () => {
    const generateSlide = vi.fn().mockImplementation(async (slide: Slide) =>
      makeSlide(slide.slide_number, ["https://docs.credal.ai/audit"])
    );
    const evaluateSlides = allUngrounded();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [
        makeSlide(1, ["https://docs.credal.ai/audit"]),
        makeSlide(2, ["https://docs.credal.ai/sso"]),
      ],
    };
    await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides, maxAttempts: 2 });
    // 2 failing slides × 2 attempts = 4 max calls
    expect(generateSlide).toHaveBeenCalledTimes(4);
  });

  it("stops regenerating a slide once it passes", async () => {
    const generateSlide = vi.fn().mockImplementation(async () => {
      return makeSlide(1, ["https://docs.credal.ai/audit"]);
    });
    // First eval: fail. Second eval (after regen): pass.
    const evaluateSlides = vi.fn()
      .mockImplementationOnce(async (slides: Slide[]) =>
        slides.map((s) => ({ slide_number: s.slide_number, grounded: false, reason: "unsupported" }))
      )
      .mockImplementation(async (slides: Slide[]) =>
        slides.map((s) => ({ slide_number: s.slide_number, grounded: true, reason: "supported" }))
      );
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [makeSlide(1, ["https://docs.credal.ai/audit"])],
    };
    const result = await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides, maxAttempts: 3 });
    // Should stop after it passes on attempt 2, not continue to attempt 3
    expect(generateSlide).toHaveBeenCalledTimes(1);
    expect(result.deck.slides[0].grounding_status).toBe("grounded");
  });

  it("calls evaluateSlides on every iteration", async () => {
    const generateSlide = vi.fn().mockImplementation(async (slide: Slide) =>
      makeSlide(slide.slide_number, ["https://docs.credal.ai/audit"])
    );
    const evaluateSlides = allUngrounded();
    const deck: Deck = {
      deal_id: "deal-1",
      company: "Acme",
      slides: [makeSlide(1, ["https://docs.credal.ai/audit"])],
    };
    await checkAndRegenerate(deck, chunks, { generateSlide, evaluateSlides, maxAttempts: 3 });
    // 3 loop iterations + 1 final evaluation = 4 calls
    expect(evaluateSlides).toHaveBeenCalledTimes(4);
  });
});
