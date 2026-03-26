// Durable deck generation via Vercel Workflow.
//
// POST handler creates a workflow_runs row and starts the workflow.
// The run_id is returned to the client immediately — the client navigates
// to /deck/{run_id} and consumes a native workflow stream for real-time
// updates. The workflow body executes durably on the server: if the function
// crashes or redeploys, it resumes from the last completed step.
//
// start() returns a Run object whose runId (the workflow platform's internal
// ID) is stored in the DB so the stream endpoint can call getRun() later.
//
// The workflow function is defined in a separate file (deck-workflow.ts)
// because it runs in a sandboxed environment that cannot import Node.js
// modules. The route handler here uses next-auth for auth, which the
// workflow sandbox would reject. Separating them lets the compiler
// analyze the workflow file independently.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { start } from "workflow/api";
import { sql } from "@/lib/db";
import { SignalsSchema } from "@/lib/schemas";
import { deckGenerationWorkflow } from "@/lib/deck-workflow";

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate signals early so we fail fast with a 400 instead of
  // starting a workflow that immediately errors on step 1
  try {
    SignalsSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid signals" }, { status: 400 });
  }

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await sql`
    INSERT INTO workflow_runs (run_id, user_id, signals, status, status_message)
    VALUES (${runId}, ${session.user.id}, ${JSON.stringify(body)}, 'pending', 'Starting...')
  `;

  // Start the workflow — returns immediately, workflow executes durably.
  // The returned Run object contains the workflow platform's internal runId,
  // which we store so the stream endpoint can call getRun() to reconnect.
  try {
    const run = await start(deckGenerationWorkflow, [runId, body, Date.now()]);
    try {
      await sql`
        UPDATE workflow_runs SET workflow_run_id = ${run.runId}, updated_at = NOW()
        WHERE run_id = ${runId}
      `;
    } catch {
      // Non-fatal: stream endpoint won't work but DB polling fallback handles it
      console.error("Failed to store workflow_run_id for", runId);
    }
  } catch (err) {
    // If workflow start fails, update the row so the client sees the error
    await sql`
      UPDATE workflow_runs
      SET status = 'error', error = ${err instanceof Error ? err.message : "Failed to start workflow"}, updated_at = NOW()
      WHERE run_id = ${runId}
    `;
    return NextResponse.json(
      { error: "Failed to start workflow" },
      { status: 500 }
    );
  }

  return NextResponse.json({ run_id: runId });
}
