import { describe, it, expect, vi } from "vitest";
import { groundSlide } from "../src/lib/grounding";
import type { Slide } from "../src/lib/schemas";
import type { GroundingChunk, SlideEvaluation } from "../src/lib/grounding";

// Mock OTel
vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setAttributes: () => {},
        recordException: () => {},
        setStatus: () => {},
        end: () => {},
      }),
    }),
  },
  SpanStatusCode: { ERROR: 2 },
}));

const chunks: GroundingChunk[] = [
  { id: 1, content: "Credal Search enables compliance search", source_url: "https://docs.credal.ai/search" },
  { id: 2, content: "Enterprise security features", source_url: "https://docs.credal.ai/security" },
];

function makeSlide(overrides?: Partial<Slide>): Slide {
  return {
    slide_number: 1,
    title: "Test Slide",
    talking_points: ["Point about compliance search"],
    features: ["Credal Search"],
    sources: ["https://docs.credal.ai/search"],
    ...overrides,
  };
}

describe("groundSlide", () => {
  it("returns grounded on first eval when slide passes", async () => {
    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>()
      .mockResolvedValue({ slide_number: 1, grounded: true, reason: "OK" });
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>();

    const result = await groundSlide(makeSlide(), chunks, {
      evaluateSlide,
      regenerateSlide,
    });

    expect(result.grounding_status).toBe("grounded");
    expect(evaluateSlide).toHaveBeenCalledOnce();
    expect(regenerateSlide).not.toHaveBeenCalled();
  });

  it("skips eval and regenerates when URL pre-filter fails", async () => {
    const slide = makeSlide({ sources: ["https://other.com/page"] });
    const regenerated = makeSlide({ sources: ["https://docs.credal.ai/search"] });

    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>()
      .mockResolvedValue({ slide_number: 1, grounded: true, reason: "OK" });
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>()
      .mockResolvedValue(regenerated);

    const result = await groundSlide(slide, chunks, {
      evaluateSlide,
      regenerateSlide,
      maxAttempts: 2,
    });

    // First attempt: URL fails → regen (no eval)
    // Second attempt: URL passes → eval passes → grounded
    expect(regenerateSlide).toHaveBeenCalledOnce();
    expect(evaluateSlide).toHaveBeenCalledOnce();
    expect(result.grounding_status).toBe("grounded");
  });

  it("regenerates and re-evaluates when eval fails, passes on second attempt", async () => {
    const regenerated = makeSlide();

    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>()
      .mockResolvedValueOnce({ slide_number: 1, grounded: false, reason: "Not grounded" })
      .mockResolvedValueOnce({ slide_number: 1, grounded: true, reason: "OK" });
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>()
      .mockResolvedValue(regenerated);

    const result = await groundSlide(makeSlide(), chunks, {
      evaluateSlide,
      regenerateSlide,
      maxAttempts: 3,
    });

    expect(result.grounding_status).toBe("grounded");
    expect(evaluateSlide).toHaveBeenCalledTimes(2);
    expect(regenerateSlide).toHaveBeenCalledOnce();
  });

  it("returns needs_review after exhausting maxAttempts", async () => {
    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>()
      .mockResolvedValue({ slide_number: 1, grounded: false, reason: "Nope" });
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>()
      .mockResolvedValue(makeSlide());

    const result = await groundSlide(makeSlide(), chunks, {
      evaluateSlide,
      regenerateSlide,
      maxAttempts: 2,
    });

    expect(result.grounding_status).toBe("needs_review");
  });

  it("evaluateSlide not called when URL pre-filter fails on all attempts", async () => {
    const badSlide = makeSlide({ sources: ["https://other.com/page"] });

    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>();
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>()
      .mockResolvedValue(badSlide); // Always returns bad URLs

    const result = await groundSlide(badSlide, chunks, {
      evaluateSlide,
      regenerateSlide,
      maxAttempts: 2,
    });

    expect(evaluateSlide).not.toHaveBeenCalled();
    expect(regenerateSlide).toHaveBeenCalledTimes(2);
    expect(result.grounding_status).toBe("needs_review");
  });

  it("total callback calls bounded by maxAttempts * 2", async () => {
    const evaluateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<SlideEvaluation>>()
      .mockResolvedValue({ slide_number: 1, grounded: false, reason: "Nope" });
    const regenerateSlide = vi.fn<(s: Slide, c: GroundingChunk[]) => Promise<Slide>>()
      .mockResolvedValue(makeSlide());

    const maxAttempts = 3;
    await groundSlide(makeSlide(), chunks, {
      evaluateSlide,
      regenerateSlide,
      maxAttempts,
    });

    const totalCalls = evaluateSlide.mock.calls.length + regenerateSlide.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(maxAttempts * 2);
  });
});
