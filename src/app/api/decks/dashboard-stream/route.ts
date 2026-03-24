// Dashboard SSE endpoint for live in-progress workflow updates.
//
// Pushes live updates to the dashboard so users see slide counts increase
// and runs complete in real time without refreshing the page.
//
// Implementation: server-side DB polling every 2s. This is simple and
// sufficient for a demo app — each poll is an indexed query on
// (user_id, status) which is cheap on Neon. A production system would
// use pg_notify or a message bus, but for a single-user demo the polling
// approach avoids infrastructure complexity.
//
// The stream closes automatically when no active runs remain, so idle
// connections don't accumulate.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSnapshot = "";

      async function poll() {
        try {
          const rows = await sql`
            SELECT run_id, status, status_message, signals, deal_id,
              jsonb_array_length(slides) as slides_count
            FROM workflow_runs
            WHERE user_id = ${userId}
              AND status NOT IN ('complete', 'error')
            ORDER BY created_at DESC
          `;

          // Also fetch recently completed runs (last 30s) so the dashboard
          // can transition them from "Generating" to a full card
          const recentlyCompleted = await sql`
            SELECT run_id, status, deal_id, signals,
              jsonb_array_length(slides) as slides_count
            FROM workflow_runs
            WHERE user_id = ${userId}
              AND status IN ('complete', 'error')
              AND updated_at > NOW() - INTERVAL '30 seconds'
            ORDER BY updated_at DESC
          `;

          const allRuns = [...(rows as Record<string, unknown>[]), ...(recentlyCompleted as Record<string, unknown>[])];

          const snapshot = JSON.stringify(allRuns);

          // Only emit if something changed
          if (snapshot !== lastSnapshot) {
            lastSnapshot = snapshot;
            const event = {
              type: "update",
              runs: allRuns.map((r) => ({
                run_id: r.run_id,
                status: r.status,
                company: (r.signals as Record<string, unknown>)?.company || "Unknown",
                slides_count: Number(r.slides_count) || 0,
                deal_id: r.deal_id || null,
              })),
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }

          // Close stream when no active runs remain
          if (rows.length === 0 && recentlyCompleted.length === 0) {
            controller.close();
            return;
          }
        } catch {
          // Transient DB error — try again on next poll
        }
      }

      // Initial emit
      await poll();

      // Poll every 2s
      const interval = setInterval(poll, 2000);

      // Cleanup on abort
      const cleanup = () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // The stream will be aborted when the client disconnects
      // We use a timeout as a safety net to prevent zombie streams
      const maxDuration = setTimeout(() => {
        cleanup();
      }, 5 * 60 * 1000); // 5 minutes max

      // Store cleanup refs so they can be called
      controller.enqueue(encoder.encode(": keepalive\n\n"));

      // ReadableStream's start() has no onclose hook. Override controller.close
      // so interval/timeout cleanup runs regardless of whether the stream closes
      // from inside (no active runs) or outside (client disconnect, max duration).
      // Without this, the interval would leak.
      const origClose = controller.close.bind(controller);
      controller.close = () => {
        clearInterval(interval);
        clearTimeout(maxDuration);
        try {
          origClose();
        } catch {
          // already closed
        }
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
