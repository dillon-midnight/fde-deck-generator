// RENDERING STRATEGY: Server Component + Client Component island.
//
// The server component queries both pipeline_runs (completed decks) and
// workflow_runs (in-progress generations), merges them into a single list,
// and passes it to the DeckList client component. The client component
// subscribes to SSE for live updates on in-progress runs.
//
// This hybrid approach gives us:
// - Instant server-rendered content (no loading spinner)
// - Live updates for in-progress runs without page refresh
// - Both completed and in-progress decks in one unified view
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Nav } from "@/components/nav";
import { DeckList, type DeckListItem } from "@/components/deck-list";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/");

  // Completed decks from pipeline_runs
  const completedDeals = await sql`
    SELECT pr.deal_id, pr.signals, pr.timestamp, pr.total_slides,
      pr.faithfulness_rate,
      CASE WHEN et.eval_id IS NOT NULL THEN 'Reviewed' ELSE 'Pending review' END as eval_status
    FROM pipeline_runs pr
    LEFT JOIN eval_tuples et ON pr.deal_id = et.deal_id AND et.user_id = ${session.user.id}
    WHERE pr.user_id = ${session.user.id}
    ORDER BY pr.timestamp DESC
  `;

  // In-progress workflow runs
  const activeRuns = await sql`
    SELECT run_id, signals, created_at, status,
      jsonb_array_length(slides) as slides_count
    FROM workflow_runs
    WHERE user_id = ${session.user.id}
      AND status NOT IN ('complete', 'error')
    ORDER BY created_at DESC
  `;

  // Merge into a single list: in-progress first, then completed
  const decks: DeckListItem[] = [
    ...(activeRuns as Record<string, unknown>[]).map((r) => ({
      deal_id: null,
      run_id: r.run_id as string,
      company: ((r.signals as Record<string, unknown>)?.company as string) || "Unknown",
      timestamp: r.created_at as string,
      total_slides: Number(r.slides_count) || 0,
      eval_status: "Generating",
      status: "Generating" as const,
    })),
    ...(completedDeals as Record<string, unknown>[]).map((d) => ({
      deal_id: d.deal_id as string,
      run_id: null,
      company: ((d.signals as Record<string, unknown>)?.company as string) || (d.deal_id as string),
      timestamp: d.timestamp as string,
      total_slides: d.total_slides as number,
      eval_status: d.eval_status as string,
    })),
  ];

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Decks</h1>
          <Link
            href="/generate"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            New deck
          </Link>
        </div>

        <DeckList initialDecks={decks} />
      </main>
    </div>
  );
}
