// Rehydration endpoint for workflow run status.
//
// Serves two roles:
// 1. One-time rehydration on page refresh — the client fetches the current
//    DB snapshot (slides, status, workflow_run_id) then opens the native
//    workflow stream from where the snapshot left off (startIndex).
// 2. Fallback if the stream connection fails after max retries.
//
// No longer the primary polling endpoint — the client consumes a native
// workflow stream via /api/decks/workflow-stream for real-time updates.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { WorkflowStatus } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = req.nextUrl.searchParams.get("run_id");
  if (!runId) {
    return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT run_id, status, status_message, slides, deal_id, error, workflow_run_id
    FROM workflow_runs
    WHERE run_id = ${runId}
  `;

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const row = rows[0];

  // Auth check: only the owner can view their run
  const ownerRows = await sql`
    SELECT user_id FROM workflow_runs WHERE run_id = ${runId}
  `;
  if (ownerRows[0]?.user_id !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const slides = typeof row.slides === "string" ? JSON.parse(row.slides) : row.slides;
  const totalSlides = Array.isArray(slides) ? slides.length : 0;
  let slidesFailedGrounding = 0;
  if (Array.isArray(slides)) {
    for (const s of slides) {
      if (s.grounding_status !== "grounded") slidesFailedGrounding++;
    }
  }
  const faithfulnessRate =
    totalSlides > 0
      ? (totalSlides - slidesFailedGrounding) / totalSlides
      : null;

  const response: WorkflowStatus = {
    run_id: row.run_id,
    status: row.status,
    status_message: row.status_message,
    slides,
    deal_id: row.deal_id || null,
    faithfulness_rate: faithfulnessRate,
    error: row.error || null,
    workflow_run_id: row.workflow_run_id || null,
  };

  return NextResponse.json(response);
}
