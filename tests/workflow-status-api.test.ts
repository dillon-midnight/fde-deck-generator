import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB responses
let mockDbRows: Record<string, unknown>[][] = [[]];
let dbCallIndex = 0;

vi.mock("../src/lib/db", () => ({
  sql: new Proxy(function () {}, {
    apply() {
      const result = mockDbRows[dbCallIndex] || [];
      dbCallIndex++;
      return Promise.resolve(result);
    },
  }),
}));

// Mock auth
let mockSession: { user: { id: string } } | null = {
  user: { id: "user-123" },
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

vi.mock("../src/lib/auth", () => ({
  authOptions: {},
}));

beforeEach(() => {
  mockDbRows = [[]];
  dbCallIndex = 0;
  mockSession = { user: { id: "user-123" } };
});

describe("GET /api/decks/workflow-status", () => {
  it("returns correct state shape for a valid run_id", async () => {
    mockDbRows = [
      [
        {
          run_id: "run-test-1",
          status: "grounding",
          status_message: "Grounding slide 2 of 5...",
          slides: [
            {
              slide_number: 1,
              title: "Slide 1",
              talking_points: ["Point"],
              features: ["Feature"],
              sources: ["https://example.com"],
              grounding_status: "grounded",
            },
          ],
          deal_id: null,
          error: null,
        },
      ],
      [{ user_id: "user-123" }],
    ];

    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );

    const req = new Request(
      "http://localhost:3000/api/decks/workflow-status?run_id=run-test-1"
    );
    // NextRequest constructor from next/server
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(req);

    const res = await GET(nextReq);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.run_id).toBe("run-test-1");
    expect(data.status).toBe("grounding");
    expect(data.status_message).toBe("Grounding slide 2 of 5...");
    expect(data.slides).toHaveLength(1);
    expect(data.deal_id).toBeNull();
    expect(data.faithfulness_rate).toBe(1);
    expect(data.error).toBeNull();
  });

  it("returns 404 for unknown run_id", async () => {
    mockDbRows = [[]];

    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(
      "http://localhost:3000/api/decks/workflow-status?run_id=run-nonexistent"
    );

    const res = await GET(nextReq);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the run", async () => {
    mockDbRows = [
      [
        {
          run_id: "run-test-2",
          status: "generation",
          status_message: "Generating...",
          slides: [],
          deal_id: null,
          error: null,
        },
      ],
      [{ user_id: "other-user-456" }],
    ];

    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(
      "http://localhost:3000/api/decks/workflow-status?run_id=run-test-2"
    );

    const res = await GET(nextReq);
    expect(res.status).toBe(403);
  });

  it("returns 401 when not authenticated", async () => {
    mockSession = null;

    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(
      "http://localhost:3000/api/decks/workflow-status?run_id=run-test-3"
    );

    const res = await GET(nextReq);
    expect(res.status).toBe(401);
  });

  it("returns 400 when run_id is missing", async () => {
    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(
      "http://localhost:3000/api/decks/workflow-status"
    );

    const res = await GET(nextReq);
    expect(res.status).toBe(400);
  });

  it("computes faithfulness_rate from slides", async () => {
    mockDbRows = [
      [
        {
          run_id: "run-test-4",
          status: "grounding",
          status_message: "Grounding...",
          slides: [
            {
              slide_number: 1,
              title: "S1",
              talking_points: [],
              features: [],
              sources: [],
              grounding_status: "grounded",
            },
            {
              slide_number: 2,
              title: "S2",
              talking_points: [],
              features: [],
              sources: [],
              grounding_status: "needs_review",
            },
          ],
          deal_id: null,
          error: null,
        },
      ],
      [{ user_id: "user-123" }],
    ];

    const { GET } = await import(
      "../src/app/api/decks/workflow-status/route"
    );
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(
      "http://localhost:3000/api/decks/workflow-status?run_id=run-test-4"
    );

    const res = await GET(nextReq);
    const data = await res.json();

    expect(data.faithfulness_rate).toBe(0.5);
  });
});
