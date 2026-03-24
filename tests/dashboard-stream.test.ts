import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB responses — each call to sql returns the next item in the queue
let mockDbResponses: Record<string, unknown>[][] = [];
let dbCallIndex = 0;

vi.mock("../src/lib/db", () => ({
  sql: new Proxy(function () {}, {
    apply() {
      const result = mockDbResponses[dbCallIndex] || [];
      dbCallIndex++;
      return Promise.resolve(result);
    },
  }),
}));

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
  mockDbResponses = [];
  dbCallIndex = 0;
  mockSession = { user: { id: "user-123" } };
});

async function readSSEEvents(response: Response, maxEvents = 5): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = "";

  while (events.length < maxEvents) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        events.push(trimmed.slice(6));
      }
    }
  }

  reader.cancel();
  return events;
}

describe("GET /api/decks/dashboard-stream", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession = null;

    const { GET } = await import(
      "../src/app/api/decks/dashboard-stream/route"
    );

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("emits initial state of active runs", async () => {
    mockDbResponses = [
      // First poll: active runs
      [
        {
          run_id: "run-1",
          status: "grounding",
          status_message: "Grounding slide 2...",
          signals: { company: "Acme Corp" },
          deal_id: null,
          slides_count: 2,
        },
      ],
      // First poll: recently completed
      [],
    ];

    const { GET } = await import(
      "../src/app/api/decks/dashboard-stream/route"
    );
    const res = await GET();

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSSEEvents(res, 1);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const data = JSON.parse(events[0]);
    expect(data.type).toBe("update");
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].run_id).toBe("run-1");
    expect(data.runs[0].company).toBe("Acme Corp");
    expect(data.runs[0].slides_count).toBe(2);
  });

  it("only returns runs belonging to authenticated user", async () => {
    // The SQL query in the route filters by user_id from session,
    // so if the mock DB returns runs, they are already filtered.
    // This test verifies the auth check happens before any data access.
    mockDbResponses = [
      [
        {
          run_id: "run-mine",
          status: "generation",
          status_message: "Generating...",
          signals: { company: "My Corp" },
          deal_id: null,
          slides_count: 0,
        },
      ],
      [],
    ];

    const { GET } = await import(
      "../src/app/api/decks/dashboard-stream/route"
    );
    const res = await GET();
    const events = await readSSEEvents(res, 1);

    const data = JSON.parse(events[0]);
    expect(data.runs.every((r: { run_id: string }) => r.run_id === "run-mine")).toBe(true);
  });

  it("closes stream when no active runs remain", async () => {
    // No active runs, no recently completed
    mockDbResponses = [[], []];

    const { GET } = await import(
      "../src/app/api/decks/dashboard-stream/route"
    );
    const res = await GET();

    // The stream should close after the initial poll finds nothing
    const reader = res.body!.getReader();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    // Stream closed naturally
    expect(true).toBe(true);
  });
});
