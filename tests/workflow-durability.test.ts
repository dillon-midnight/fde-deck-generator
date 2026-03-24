import { describe, it, expect, vi, beforeEach } from "vitest";

// Track all SQL calls by capturing the raw template strings and params
const sqlCalls: { strings: string; params: unknown[] }[] = [];
const mockSqlFn = vi.fn(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    sqlCalls.push({
      strings: strings.join("$"),
      params: values,
    });
    return Promise.resolve([]);
  }
);

vi.mock("../src/lib/db", () => ({
  sql: mockSqlFn,
}));

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

vi.mock("../src/lib/injection", () => ({
  injectionDetected: vi.fn().mockReturnValue(false),
}));

const mockChunks = [
  {
    id: 1,
    content: "Credal AI search features",
    source_url: "https://docs.credal.ai/search",
    score: 0.95,
  },
  {
    id: 2,
    content: "Enterprise security",
    source_url: "https://docs.credal.ai/security",
    score: 0.9,
  },
];

vi.mock("../src/lib/rag", () => ({
  vectorSearch: vi.fn().mockResolvedValue(mockChunks),
}));

vi.mock("../src/lib/prompts", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
  buildUserPrompt: vi.fn().mockReturnValue("user prompt"),
}));

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

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    partialOutputStream: (async function* () {
      yield { slides: [mockSlides[0], mockSlides[1]] };
    })(),
    output: Promise.resolve({ slides: mockSlides }),
  })),
  generateText: vi.fn(() =>
    Promise.resolve({
      output: { slide_number: 1, grounded: true, reason: "OK" },
    })
  ),
  Output: {
    object: vi.fn(({ schema }: { schema: unknown }) => schema),
  },
}));

vi.mock("@ai-sdk/gateway", () => ({
  gateway: vi.fn((modelId: string) => ({ _modelId: modelId })),
}));

const signals = {
  company: "Test Co",
  industry: "Tech",
  pain_points: ["Problem"],
  use_cases: ["Solution"],
  objections: [],
  tools: [],
};

beforeEach(() => {
  sqlCalls.length = 0;
  mockSqlFn.mockClear();
});

function findCall(...patterns: string[]): (typeof sqlCalls)[0] | undefined {
  return sqlCalls.find((c) =>
    patterns.every((p) => c.strings.includes(p))
  );
}

describe("workflow step DB state changes", () => {
  it("retrieveContext updates status to 'retrieval'", async () => {
    const { retrieveContext } = await import(
      "../src/lib/generate-deck-workflow"
    );

    await retrieveContext(signals, "run-test-1");

    const update = findCall("UPDATE workflow_runs", "retrieval");
    expect(update).toBeDefined();
  });

  it("generateAllSlides updates status to 'generation'", async () => {
    const { generateAllSlides } = await import(
      "../src/lib/generate-deck-workflow"
    );

    await generateAllSlides(signals, mockChunks, [], "run-test-2");

    const update = findCall("UPDATE workflow_runs", "generation");
    expect(update).toBeDefined();
  });

  it("groundAndPersistSlide appends slide to workflow_runs.slides", async () => {
    const { groundAndPersistSlide } = await import(
      "../src/lib/generate-deck-workflow"
    );

    await groundAndPersistSlide(mockSlides[0], mockChunks, "run-test-3", 0, 2);

    const groundingUpdate = findCall("UPDATE workflow_runs", "grounding");
    expect(groundingUpdate).toBeDefined();

    const slideAppend = findCall("slides = slides ||");
    expect(slideAppend).toBeDefined();
  });

  it("slides array grows as grounding progresses", async () => {
    const { groundAndPersistSlide } = await import(
      "../src/lib/generate-deck-workflow"
    );

    await groundAndPersistSlide(mockSlides[0], mockChunks, "run-test-4", 0, 2);
    const firstAppends = sqlCalls.filter((c) =>
      c.strings.includes("slides = slides ||")
    );
    expect(firstAppends.length).toBe(1);

    await groundAndPersistSlide(mockSlides[1], mockChunks, "run-test-4", 1, 2);
    const allAppends = sqlCalls.filter((c) =>
      c.strings.includes("slides = slides ||")
    );
    expect(allAppends.length).toBe(2);
  });

  it("finalizePipelineRun inserts pipeline_runs and sets status to 'complete'", async () => {
    const { finalizePipelineRun } = await import(
      "../src/lib/generate-deck-workflow"
    );

    const groundedSlides = mockSlides.map((s) => ({
      ...s,
      grounding_status: "grounded" as const,
    }));

    await finalizePipelineRun(
      "run-test-5",
      signals,
      groundedSlides,
      mockChunks,
      Date.now() - 5000
    );

    const pipelineInsert = findCall("INSERT INTO pipeline_runs");
    expect(pipelineInsert).toBeDefined();

    const completeUpdate = findCall("UPDATE workflow_runs", "complete");
    expect(completeUpdate).toBeDefined();
  });

  it("finalizePipelineRun sets deal_id on workflow_runs", async () => {
    const { finalizePipelineRun } = await import(
      "../src/lib/generate-deck-workflow"
    );

    const groundedSlides = mockSlides.map((s) => ({
      ...s,
      grounding_status: "grounded" as const,
    }));

    const result = await finalizePipelineRun(
      "run-test-6",
      signals,
      groundedSlides,
      mockChunks,
      Date.now() - 5000
    );

    expect(result.dealId).toMatch(/^deal-/);
    expect(result.faithfulnessRate).toBe(1);

    const dealUpdate = sqlCalls.find(
      (c) =>
        c.strings.includes("deal_id") &&
        c.strings.includes("workflow_runs") &&
        c.params.some(
          (p) => typeof p === "string" && (p as string).startsWith("deal-")
        )
    );
    expect(dealUpdate).toBeDefined();
  });

  it("finalizePipelineRun computes correct faithfulness_rate with failed slides", async () => {
    const { finalizePipelineRun } = await import(
      "../src/lib/generate-deck-workflow"
    );

    const groundedSlides = [
      { ...mockSlides[0], grounding_status: "grounded" as const },
      { ...mockSlides[1], grounding_status: "needs_review" as const },
    ];

    const result = await finalizePipelineRun(
      "run-test-7",
      signals,
      groundedSlides,
      mockChunks,
      Date.now() - 5000
    );

    expect(result.faithfulnessRate).toBe(0.5);
  });
});
