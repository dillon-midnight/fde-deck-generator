// RENDERING STRATEGY: Three-case routing for deck pages.
//
// 1. run-* IDs (e.g., /deck/run-1234567890-abc123) — in-progress workflow run.
//    Delegates to StreamingDeckView with the runId prop. The client component
//    polls the server for status updates. Survives page refresh because the
//    run_id is in the URL and state rehydrates from the DB.
//
// 2. "streaming" (legacy) — redirect to /generate. This was the old SSE path
//    where all state lived in React memory. No longer used, but kept as a
//    redirect so stale bookmarks don't 404.
//
// 3. Saved decks (e.g., /deck/deal-1234567890-abc123) — rendered entirely on
//    the server. The page queries the DB directly, eliminating the client-side
//    fetch waterfall.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Nav } from "@/components/nav";
import { DeckEditor } from "@/components/deck-editor";
import { StreamingDeckView } from "@/components/streaming-deck-view";
import Link from "next/link";
import type { Deck } from "@/lib/schemas";

export default async function DeckPage({
  params,
}: {
  params: Promise<{ deal_id: string }>;
}) {
  const { deal_id } = await params;

  // In-progress workflow run: delegate to client component with runId
  if (deal_id.startsWith("run-")) {
    return <StreamingDeckView runId={deal_id} />;
  }

  // Legacy SSE path: redirect to generate page
  if (deal_id === "streaming") {
    redirect("/generate");
  }

  // Saved deck path: server-render with direct DB access
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/");
  }

  const runs = await sql`
    SELECT * FROM pipeline_runs
    WHERE deal_id = ${deal_id} AND user_id = ${session.user.id}
  `;

  if (!runs || runs.length === 0) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center py-12">
            <p className="text-neutral-600 dark:text-neutral-400 mb-4">
              Deck not found
            </p>
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Back to dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const run = runs[0];

  const evals = await sql`
    SELECT ae_diff, generated_deck as edited_deck FROM eval_tuples
    WHERE deal_id = ${deal_id} AND user_id = ${session.user.id}
    ORDER BY timestamp DESC LIMIT 1
  `;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <DeckEditor
          initialDeck={run.generated_deck}
          existingEval={evals.length > 0 ? (evals[0] as { ae_diff: unknown; edited_deck: Deck }) : null}
        />
      </main>
    </div>
  );
}
