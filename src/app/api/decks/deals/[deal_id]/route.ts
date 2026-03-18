import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  try {
    const session = await requireAuth();
    const { deal_id } = await params;

    const runs = await sql`
      SELECT * FROM pipeline_runs
      WHERE deal_id = ${deal_id} AND user_id = ${session.user.id}
    `;

    if (!runs || runs.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const run = runs[0];

    // Check for eval
    const evals = await sql`
      SELECT ae_diff, generated_deck as edited_deck FROM eval_tuples
      WHERE deal_id = ${deal_id} AND user_id = ${session.user.id}
      ORDER BY timestamp DESC LIMIT 1
    `;

    return NextResponse.json({
      deck: run.generated_deck,
      pipelineRun: run,
      eval: evals.length > 0 ? evals[0] : null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
