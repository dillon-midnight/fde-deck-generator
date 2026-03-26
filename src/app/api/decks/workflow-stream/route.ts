// SSE endpoint for native workflow stream consumption.
//
// Serves real-time slide and status events from the workflow's Redis-backed
// durable streams. The client opens this after an initial rehydration fetch
// to /api/decks/workflow-status, passing slide_start_index to skip slides
// already loaded from the DB snapshot. Supports reconnection on refresh via
// the same startIndex mechanism.
//
// Two namespaced readable streams ("slides" and "status") are multiplexed
// into a single SSE response with distinct event types.

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getRun } from "workflow/api";
import type { Slide } from "@/lib/schemas";

interface StatusUpdate {
  status: string;
  message: string;
  deal_id?: string;
  faithfulness_rate?: number;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = req.nextUrl.searchParams.get("run_id");
  const workflowRunId = req.nextUrl.searchParams.get("workflow_run_id");
  const slideStartIndex = parseInt(
    req.nextUrl.searchParams.get("slide_start_index") || "0",
    10
  );

  if (!runId || !workflowRunId) {
    return new Response(
      JSON.stringify({ error: "Missing run_id or workflow_run_id" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Ownership check
  const rows = await sql`
    SELECT user_id FROM workflow_runs WHERE run_id = ${runId}
  `;
  if (!rows?.length || rows[0].user_id !== session.user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const run = getRun(workflowRunId);
  const slidesReadable = run.getReadable<Slide>({
    namespace: "slides",
    startIndex: slideStartIndex,
  });
  const statusReadable = run.getReadable<StatusUpdate>({
    namespace: "status",
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  async function writeSSE(event: string, data: unknown) {
    await writer.write(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  }

  // Multiplex both readable streams into SSE
  const slidesPromise = (async () => {
    const reader = slidesReadable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writeSSE("slide", value);
      }
    } finally {
      reader.releaseLock();
    }
  })();

  const statusPromise = (async () => {
    const reader = statusReadable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writeSSE("status", value);
      }
    } finally {
      reader.releaseLock();
    }
  })();

  // When both streams end, close the SSE response
  Promise.all([slidesPromise, statusPromise]).then(
    () => writer.close(),
    (err) => writer.abort(err)
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
