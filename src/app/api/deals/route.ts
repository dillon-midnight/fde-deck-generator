import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    const session = await requireAuth();

    const runs = await sql`
      SELECT pr.deal_id, pr.signals, pr.timestamp, pr.total_slides,
        pr.faithfulness_rate,
        CASE WHEN et.eval_id IS NOT NULL THEN 'Reviewed' ELSE 'Pending review' END as eval_status
      FROM pipeline_runs pr
      LEFT JOIN eval_tuples et ON pr.deal_id = et.deal_id AND et.user_id = ${session.user.id}
      WHERE pr.user_id = ${session.user.id}
      ORDER BY pr.timestamp DESC
    `;

    return NextResponse.json({ deals: runs });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
