"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { Nav } from "@/components/nav";
import { DeckEditor } from "@/components/deck-editor";
import type { Deck } from "@/lib/schemas";

export default function DeckPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const dealId = params.deal_id as string;

  const [deck, setDeck] = useState<Deck | null>(null);
  const [evalData, setEvalData] = useState<{ ae_diff: unknown; edited_deck: Deck } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (!session || !dealId) return;

    fetch(`/api/decks/deals/${dealId}`)
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 404) throw new Error("Deck not found");
          throw new Error("Failed to load deck");
        }
        return r.json();
      })
      .then((data) => {
        setDeck(data.deck);
        setEvalData(data.eval);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [session, dealId]);

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <p className="text-neutral-500">Loading deck...</p>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
            >
              Back to dashboard
            </button>
          </div>
        ) : deck ? (
          <DeckEditor initialDeck={deck} existingEval={evalData} />
        ) : null}
      </main>
    </div>
  );
}
