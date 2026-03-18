import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../src/lib/rag", () => ({
  vectorSearch: vi.fn().mockResolvedValue([
    { id: 1, content: "Content", source_url: "https://docs.credal.ai/search", score: 0.95 },
  ]),
}));

vi.mock("../src/lib/prompts", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("system"),
  buildUserPrompt: vi.fn().mockReturnValue("user"),
}));

const mockSlides = [
  {
    slide_number: 1,
    title: "Slide 1",
    talking_points: ["Point"],
    features: ["Feature"],
    sources: ["https://docs.credal.ai/search"],
  },
];

// Track model routing
const streamTextModels: string[] = [];
const generateTextModels: string[] = [];

vi.mock("ai", () => ({
  streamText: vi.fn(({ model }: { model: { _modelId: string } }) => {
    streamTextModels.push(model._modelId);
    return {
      partialOutputStream: (async function* () {
        yield { slides: mockSlides };
      })(),
      output: Promise.resolve({ slides: mockSlides }),
    };
  }),
  generateText: vi.fn(({ model }: { model: { _modelId: string } }) => {
    generateTextModels.push(model._modelId);
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
  streamTextModels.length = 0;
  generateTextModels.length = 0;
});

describe("model routing", () => {
  it("uses Claude Sonnet for streamText generation", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test",
        industry: "Tech",
        pain_points: ["P"],
        use_cases: ["U"],
        objections: [],
        tools: [],
      },
      "user-1",
      () => {}
    );

    expect(streamTextModels).toContain("anthropic/claude-sonnet-4-6");
  });

  it("uses Gemini Flash Lite for grounding eval", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test",
        industry: "Tech",
        pain_points: ["P"],
        use_cases: ["U"],
        objections: [],
        tools: [],
      },
      "user-1",
      () => {}
    );

    expect(generateTextModels).toContain("google/gemini-2.0-flash-lite");
  });

  it("streamText never called with Gemini model", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test",
        industry: "Tech",
        pain_points: ["P"],
        use_cases: ["U"],
        objections: [],
        tools: [],
      },
      "user-1",
      () => {}
    );

    for (const model of streamTextModels) {
      expect(model).not.toContain("gemini");
    }
  });

  it("grounding generateText calls never use Claude model", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");

    await generateDeckStream(
      {
        company: "Test",
        industry: "Tech",
        pain_points: ["P"],
        use_cases: ["U"],
        objections: [],
        tools: [],
      },
      "user-1",
      () => {}
    );

    for (const model of generateTextModels) {
      expect(model).not.toContain("claude");
    }
  });
});
