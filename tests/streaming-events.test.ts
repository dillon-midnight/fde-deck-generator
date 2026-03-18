import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamEvent } from "../src/lib/schemas";

// Collect events
let emittedEvents: StreamEvent[] = [];
function emit(event: StreamEvent) {
  emittedEvents.push(event);
}

// Mock all external deps
vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setAttributes: () => {},
        setAttribute: () => {},
        recordException: () => {},
        setStatus: () => {},
        end: () => {},
      }),
    }),
  },
  SpanStatusCode: { ERROR: 2 },
}));

vi.mock("../src/lib/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock("../src/lib/db", () => ({
  sql: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/injection", () => ({
  injectionDetected: vi.fn().mockReturnValue(false),
}));

const mockChunks = [
  { id: 1, content: "Credal AI search features", source_url: "https://docs.credal.ai/search", score: 0.95 },
  { id: 2, content: "Enterprise security", source_url: "https://docs.credal.ai/security", score: 0.9 },
];

vi.mock("../src/lib/rag", () => ({
  vectorSearch: vi.fn().mockResolvedValue(mockChunks),
}));

vi.mock("../src/lib/prompts", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
  buildUserPrompt: vi.fn().mockReturnValue("user prompt"),
}));

// Mock slide data
const mockSlides = [
  {
    slide_number: 1,
    title: "Slide 1",
    talking_points: ["Point 1"],
    features: ["Feature 1"],
    sources: ["https://docs.credal.ai/search"],
  },
  {
    slide_number: 2,
    title: "Slide 2",
    talking_points: ["Point 2"],
    features: ["Feature 2"],
    sources: ["https://docs.credal.ai/security"],
  },
];

// Track which models are called
const streamTextCalls: string[] = [];
const generateTextCalls: string[] = [];

vi.mock("ai", () => ({
  streamText: vi.fn(({ model }: { model: { _modelId: string } }) => {
    streamTextCalls.push(model._modelId || "unknown");
    return {
      partialOutputStream: (async function* () {
        yield { slides: [mockSlides[0], mockSlides[1]] };
      })(),
      output: Promise.resolve({ slides: mockSlides }),
    };
  }),
  generateText: vi.fn(({ model }: { model: { _modelId: string } }) => {
    generateTextCalls.push(model._modelId || "unknown");
    return Promise.resolve({
      output: { slide_number: 1, grounded: true, reason: "OK" },
    });
  }),
  Output: {
    object: vi.fn(({ schema }: { schema: unknown }) => schema),
  },
}));

vi.mock("@ai-sdk/gateway", () => ({
  gateway: vi.fn((modelId: string) => ({ _modelId: modelId })),
}));

beforeEach(() => {
  emittedEvents = [];
  streamTextCalls.length = 0;
  generateTextCalls.length = 0;
});

describe("generateDeckStream events", () => {
  it("emits events in correct order: stage → slide → stage(saving) → complete", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test Co",
        industry: "Tech",
        pain_points: ["Problem"],
        use_cases: ["Solution"],
        objections: [],
        tools: [],
      },
      "user-123",
      emit
    );

    const types = emittedEvents.map((e) => e.type);

    // Should start with stage events
    expect(types[0]).toBe("stage");

    // Should have at least one slide event
    expect(types).toContain("slide");

    // Should end with stage(saving) then complete
    const savingIdx = emittedEvents.findIndex(
      (e) => e.type === "stage" && e.stage === "saving"
    );
    expect(savingIdx).toBeGreaterThan(0);

    const lastEvent = emittedEvents[emittedEvents.length - 1];
    expect(lastEvent.type).toBe("complete");
  });

  it("every emitted slide has grounding_status set", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test Co",
        industry: "Tech",
        pain_points: ["Problem"],
        use_cases: ["Solution"],
        objections: [],
        tools: [],
      },
      "user-123",
      emit
    );

    const slideEvents = emittedEvents.filter(
      (e): e is Extract<StreamEvent, { type: "slide" }> => e.type === "slide"
    );

    expect(slideEvents.length).toBeGreaterThan(0);
    for (const event of slideEvents) {
      expect(event.slide.grounding_status).toBeDefined();
      expect(["grounded", "needs_review"]).toContain(event.slide.grounding_status);
    }
  });

  it("complete event has faithfulness_rate", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test Co",
        industry: "Tech",
        pain_points: ["Problem"],
        use_cases: ["Solution"],
        objections: [],
        tools: [],
      },
      "user-123",
      emit
    );

    const completeEvent = emittedEvents.find((e) => e.type === "complete") as {
      type: "complete";
      deal_id: string;
      faithfulness_rate: number;
    };

    expect(completeEvent).toBeDefined();
    expect(typeof completeEvent.faithfulness_rate).toBe("number");
    expect(completeEvent.faithfulness_rate).toBeGreaterThanOrEqual(0);
    expect(completeEvent.faithfulness_rate).toBeLessThanOrEqual(1);
  });
});

describe("generateDeckStream error handling", () => {
  it("emits error when vectorSearch returns empty", async () => {
    const { vectorSearch } = await import("../src/lib/rag");
    vi.mocked(vectorSearch).mockResolvedValueOnce([]);

    // Re-import to get fresh module with updated mock
    vi.resetModules();
    // Need to re-setup mocks after reset for this specific test
    const events: StreamEvent[] = [];

    // Since module reset clears mocks, we test the behavior through the existing mock
    vi.mocked(vectorSearch).mockResolvedValueOnce([]);
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test Co",
        industry: "Tech",
        pain_points: ["Problem"],
        use_cases: ["Solution"],
        objections: [],
        tools: [],
      },
      "user-123",
      (e) => events.push(e)
    );

    const errorEvent = events.find(
      (e): e is Extract<StreamEvent, { type: "error" }> => e.type === "error"
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).toContain("chunk");
  });
});
