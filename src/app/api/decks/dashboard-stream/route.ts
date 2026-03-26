// Dashboard SSE endpoint for live in-progress workflow updates.
//
// Pushes live updates to the dashboard so users see slide counts increase
// and runs complete in real time without refreshing the page.
//
// Implementation: multiplexes native Vercel Workflow durable streams from
// all active runs into a single SSE response. Each active run's "slides"
// and "status" namespaces are consumed via getRun().getReadable(). A
// lightweight DB poll every 5s detects newly started runs and spawns
// additional stream readers for them.
//
// The stream closes automatically when no active runs remain, so idle
// connections don't accumulate.

import { NextResponse } from "next/server";
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

interface RunState {
  run_id: string;
  workflow_run_id: string;
  company: string;
  slides_count: number;
  status: string;
  deal_id: string | null;
  activeStreams: number; // decremented as each readable ends
}

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const runStates = new Map<string, RunState>();
  let lastEmittedSnapshot = "";
  let closed = false;

  function emitUpdate() {
    if (closed) return;
    const runs = Array.from(runStates.values()).map((r) => ({
      run_id: r.run_id,
      status: r.status,
      company: r.company,
      slides_count: r.slides_count,
      deal_id: r.deal_id,
    }));
    const event = { type: "update", runs };
    const snapshot = JSON.stringify(event);
    if (snapshot === lastEmittedSnapshot) return;
    lastEmittedSnapshot = snapshot;
    writer
      .write(encoder.encode(`data: ${snapshot}\n\n`))
      .catch(() => {});
  }

  function closeStream() {
    if (closed) return;
    closed = true;
    writer.close().catch(() => {});
  }

  // Start streaming readers for a single run
  function attachStreamReaders(state: RunState) {
    let slidesReadable: ReadableStream<Slide>;
    let statusReadable: ReadableStream<StatusUpdate>;
    try {
      const run = getRun(state.workflow_run_id);
      slidesReadable = run.getReadable<Slide>({ namespace: "slides" });
      statusReadable = run.getReadable<StatusUpdate>({ namespace: "status" });
    } catch {
      // Workflow stream unavailable — keep DB state, don't attach readers
      state.activeStreams = 0;
      return;
    }

    state.activeStreams = 2;

    // Slides reader
    (async () => {
      const reader = slidesReadable.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          state.slides_count++;
          emitUpdate();
        }
      } catch {
        // Stream errored — stop reading
      } finally {
        reader.releaseLock();
        state.activeStreams--;
        if (state.activeStreams <= 0) onRunFinished(state);
      }
    })();

    // Status reader
    (async () => {
      const reader = statusReadable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          state.status = value.status;
          if (value.deal_id) state.deal_id = value.deal_id;
          emitUpdate();
        }
      } catch {
        // Stream errored — stop reading
      } finally {
        reader.releaseLock();
        state.activeStreams--;
        if (state.activeStreams <= 0) onRunFinished(state);
      }
    })();
  }

  // When a run's streams both end, keep it visible for 30s then remove
  function onRunFinished(state: RunState) {
    // Mark complete if the status stream didn't already
    if (state.status !== "complete" && state.status !== "error") {
      state.status = "complete";
      emitUpdate();
    }
    setTimeout(() => {
      runStates.delete(state.run_id);
      emitUpdate();
      // If no runs left and polling has stopped, close
      if (runStates.size === 0 && !pollInterval) {
        closeStream();
      }
    }, 30_000);
  }

  // --- Initial DB query: active runs + recently completed ---
  const [activeRows, recentRows] = await Promise.all([
    sql`
      SELECT run_id, workflow_run_id, status, signals, deal_id,
        jsonb_array_length(slides) as slides_count
      FROM workflow_runs
      WHERE user_id = ${userId}
        AND status NOT IN ('complete', 'error')
      ORDER BY created_at DESC
    `,
    sql`
      SELECT run_id, status, deal_id, signals,
        jsonb_array_length(slides) as slides_count
      FROM workflow_runs
      WHERE user_id = ${userId}
        AND status IN ('complete', 'error')
        AND updated_at > NOW() - INTERVAL '30 seconds'
      ORDER BY updated_at DESC
    `,
  ]);

  // If nothing active and nothing recent, close immediately
  if (activeRows.length === 0 && recentRows.length === 0) {
    // Emit empty update and close
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: "update", runs: [] })}\n\n`)).catch(() => {});
    closeStream();
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Populate recently completed runs (no stream readers needed)
  for (const r of recentRows as Record<string, unknown>[]) {
    const state: RunState = {
      run_id: r.run_id as string,
      workflow_run_id: "",
      company: ((r.signals as Record<string, unknown>)?.company as string) || "Unknown",
      slides_count: Number(r.slides_count) || 0,
      status: r.status as string,
      deal_id: (r.deal_id as string) || null,
      activeStreams: 0,
    };
    runStates.set(state.run_id, state);
  }

  // Populate active runs and attach workflow stream readers
  for (const r of activeRows as Record<string, unknown>[]) {
    const state: RunState = {
      run_id: r.run_id as string,
      workflow_run_id: (r.workflow_run_id as string) || "",
      company: ((r.signals as Record<string, unknown>)?.company as string) || "Unknown",
      slides_count: Number(r.slides_count) || 0,
      status: (r.status as string) || "generating",
      deal_id: (r.deal_id as string) || null,
      activeStreams: 0,
    };
    runStates.set(state.run_id, state);

    if (state.workflow_run_id) {
      attachStreamReaders(state);
    }
  }

  // Emit initial snapshot
  emitUpdate();

  // --- New-run detection poll (every 5s) ---
  let pollInterval: ReturnType<typeof setInterval> | null = setInterval(async () => {
    if (closed) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = null;
      return;
    }
    try {
      const newRows = await sql`
        SELECT run_id, workflow_run_id, status, signals, deal_id,
          jsonb_array_length(slides) as slides_count
        FROM workflow_runs
        WHERE user_id = ${userId}
          AND status NOT IN ('complete', 'error')
        ORDER BY created_at DESC
      `;

      for (const r of newRows as Record<string, unknown>[]) {
        const runId = r.run_id as string;
        const wfRunId = (r.workflow_run_id as string) || "";
        if (!runStates.has(runId) && wfRunId) {
          const state: RunState = {
            run_id: runId,
            workflow_run_id: wfRunId,
            company: ((r.signals as Record<string, unknown>)?.company as string) || "Unknown",
            slides_count: Number(r.slides_count) || 0,
            status: (r.status as string) || "generating",
            deal_id: (r.deal_id as string) || null,
            activeStreams: 0,
          };
          runStates.set(runId, state);
          attachStreamReaders(state);
          emitUpdate();
        } else if (runStates.has(runId) && !runStates.get(runId)!.workflow_run_id && wfRunId) {
          // Run existed but didn't have a workflow_run_id yet — attach now
          const state = runStates.get(runId)!;
          state.workflow_run_id = wfRunId;
          attachStreamReaders(state);
        }
      }
    } catch {
      // Transient DB error — try again next poll
    }
  }, 5000);

  // --- 5-minute safety timeout ---
  const maxDuration = setTimeout(() => {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    closeStream();
  }, 5 * 60 * 1000);

  // Clean up timeout if stream closes early
  const origClose = writer.close.bind(writer);
  writer.close = async () => {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    clearTimeout(maxDuration);
    try {
      await origClose();
    } catch {
      // already closed
    }
  };

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
