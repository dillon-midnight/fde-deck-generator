// RENDERING STRATEGY: Hybrid Server/Client split. This page is a Server Component
// that handles two cases:
//
// 1. Saved decks (deal_id !== "streaming") — rendered entirely on the server.
//    The page queries the DB directly, eliminating the client-side fetch waterfall
//    (load JS → hydrate → useEffect → fetch API → API queries DB → setState → render).
//    Data is passed as props to the client DeckEditor component.
//
// 2. Streaming decks (deal_id === "streaming") — delegates to StreamingDeckView,
//    a Client Component that consumes SSE events via useDeckStreamContext().
//    SSE requires a persistent browser connection, so this path must be client-rendered.

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

  // Streaming path: delegate entirely to client component
  if (deal_id === "streaming") {
    return <StreamingDeckView />;
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
