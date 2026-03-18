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

// Track model routing and providerOptions
const streamTextCalls: { model: string; providerOptions?: unknown }[] = [];
const generateTextCalls: { model: string; providerOptions?: unknown }[] = [];

vi.mock("ai", () => ({
  streamText: vi.fn(({ model, providerOptions }: { model: { _modelId: string }; providerOptions?: unknown }) => {
    streamTextCalls.push({ model: model._modelId, providerOptions });
    return {
      partialOutputStream: (async function* () {
        yield { slides: mockSlides };
      })(),
      output: Promise.resolve({ slides: mockSlides }),
    };
  }),
  generateText: vi.fn(({ model, providerOptions }: { model: { _modelId: string }; providerOptions?: unknown }) => {
    generateTextCalls.push({ model: model._modelId, providerOptions });
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

const validSignals = {
  company: "Test",
  industry: "Tech",
  pain_points: ["P"],
  use_cases: ["U"],
  objections: [],
  tools: [],
};

beforeEach(() => {
  streamTextCalls.length = 0;
  generateTextCalls.length = 0;
});

describe("model routing", () => {
  it("uses Claude Sonnet for streamText generation", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    expect(streamTextCalls[0].model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("passes generation provider options with ZDR to streamText", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    expect(streamTextCalls[0].providerOptions).toEqual({
      gateway: {
        zeroDataRetention: true,
        models: ["google/gemini-2.5-pro", "mistral/mistral-large-latest"],
      },
    });
  });

  it("uses Gemini Flash Lite for grounding eval", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    expect(generateTextCalls.some((c) => c.model === "google/gemini-2.0-flash-lite")).toBe(true);
  });

  it("passes grounding provider options with ZDR to generateText", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    const groundingCalls = generateTextCalls.filter((c) => c.model === "google/gemini-2.0-flash-lite");
    expect(groundingCalls.length).toBeGreaterThan(0);
    for (const call of groundingCalls) {
      expect(call.providerOptions).toEqual({
        gateway: {
          zeroDataRetention: true,
          models: ["anthropic/claude-haiku-4-5", "groq/llama-3.3-70b-versatile"],
        },
      });
    }
  });

  it("all AI calls have zeroDataRetention enabled", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of [...streamTextCalls, ...generateTextCalls]) {
      const opts = call.providerOptions as { gateway?: { zeroDataRetention?: boolean } };
      expect(opts?.gateway?.zeroDataRetention).toBe(true);
    }
  });

  it("no OpenAI models in any fallback chain", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of [...streamTextCalls, ...generateTextCalls]) {
      const models = (call.providerOptions as { gateway?: { models?: string[] } })?.gateway?.models ?? [];
      for (const model of models) {
        expect(model).not.toMatch(/^openai\//);
      }
    }
  });

  it("streamText never called with Gemini model", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of streamTextCalls) {
      expect(call.model).not.toContain("gemini");
    }
  });

  it("grounding generateText calls never use Claude model", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of generateTextCalls) {
      expect(call.model).not.toContain("claude");
    }
  });

  it("generation fallbacks don't appear in grounding calls", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of generateTextCalls) {
      const models = (call.providerOptions as { gateway?: { models?: string[] } })?.gateway?.models ?? [];
      expect(models).not.toContain("google/gemini-2.5-pro");
      expect(models).not.toContain("mistral/mistral-large-latest");
    }
  });

  it("grounding fallbacks don't appear in generation calls", async () => {
    const { generateDeckStream } = await import("../src/lib/generate-deck-stream");
    await generateDeckStream(validSignals, "user-1", () => {});

    for (const call of streamTextCalls) {
      const models = (call.providerOptions as { gateway?: { models?: string[] } })?.gateway?.models ?? [];
      expect(models).not.toContain("anthropic/claude-haiku-4-5");
      expect(models).not.toContain("groq/llama-3.3-70b-versatile");
    }
  });
});
