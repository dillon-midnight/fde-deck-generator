// RENDERING STRATEGY: Dynamic SSR with Streaming (Suspense).
// The dashboard is a read-only list of links — zero interactivity. Making
// it a Server Component lets us fetch deals directly from the database
// on the server, eliminating the client-side waterfall that the previous
// CSR version had: load JS → hydrate → useEffect fires → fetch /api/deals
// → API queries DB → setState → re-render. Now it's a single server
// roundtrip. The sibling loading.tsx creates an automatic Suspense boundary
// so navigation feels instant — the shell streams first, then the
// data-dependent content streams in when the DB query resolves.
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Nav } from "@/components/nav";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/");

  const deals = await sql`
    SELECT pr.deal_id, pr.signals, pr.timestamp, pr.total_slides,
      pr.faithfulness_rate,
      CASE WHEN et.eval_id IS NOT NULL THEN 'Reviewed' ELSE 'Pending review' END as eval_status
    FROM pipeline_runs pr
    LEFT JOIN eval_tuples et ON pr.deal_id = et.deal_id AND et.user_id = ${session.user.id}
    WHERE pr.user_id = ${session.user.id}
    ORDER BY pr.timestamp DESC
  `;

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

        {deals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-neutral-500 mb-4">No decks generated yet.</p>
            <Link
              href="/generate"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Generate your first deck
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {deals.map((deal) => (
              <Link
                key={deal.deal_id}
                href={`/deck/${deal.deal_id}`}
                className="block p-4 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{deal.signals?.company || deal.deal_id}</p>
                    <p className="text-sm text-neutral-500">
                      {new Date(deal.timestamp).toLocaleDateString()} · {deal.total_slides} slides
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded ${
                      deal.eval_status === "Reviewed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    }`}
                  >
                    {deal.eval_status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
