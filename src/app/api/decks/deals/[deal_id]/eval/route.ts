import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { EvalRequestSchema } from "@/lib/schemas";
import { computeDiff } from "@/lib/diff";
import { sql } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deal_id: string }> }
) {
  try {
    const session = await requireAuth();
    const { deal_id } = await params;

    // Get the original pipeline run
    const runs = await sql`
      SELECT deal_id, signals, generated_deck, retrieved_chunk_ids
      FROM pipeline_runs
      WHERE deal_id = ${deal_id} AND user_id = ${session.user.id}
    `;

    if (!runs || runs.length === 0) {
      return NextResponse.json({ error: "Deal not found" }, { status: 400 });
    }

    const run = runs[0];

    const body = await req.json();
    const { edited_deck } = EvalRequestSchema.parse(body);

    const diff = computeDiff(run.generated_deck, edited_deck);

    await sql`
      INSERT INTO eval_tuples (deal_id, user_id, transcript_signals, retrieved_chunk_ids, generated_deck, ae_diff)
      VALUES (${deal_id}, ${session.user.id}, ${JSON.stringify(run.signals)}, ${run.retrieved_chunk_ids}, ${JSON.stringify(edited_deck)}, ${JSON.stringify(diff)})
      ON CONFLICT (eval_id) DO NOTHING
    `;

    return NextResponse.json({ diff }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Eval error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 400 });
  }
}
