"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { Nav } from "@/components/nav";
import { DeckEditor } from "@/components/deck-editor";
import { useDeckStreamContext } from "@/contexts/deck-stream-context";
import type { Deck } from "@/lib/schemas";

export default function DeckPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const dealId = params.deal_id as string;
  const isStreamingRoute = dealId === "streaming";

  const ctx = useDeckStreamContext();

  const [fetchedDeck, setFetchedDeck] = useState<Deck | null>(null);
  const [evalData, setEvalData] = useState<{
    ae_diff: unknown;
    edited_deck: Deck;
  } | null>(null);
  const needsFetch = !isStreamingRoute && !(ctx.result?.deal_id === dealId && ctx.slides.length > 0);
  const [fetching, setFetching] = useState(needsFetch);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  // Streaming mode: redirect to /generate if no active stream
  useEffect(() => {
    if (!isStreamingRoute) return;
    if (!ctx.isStreaming && ctx.slides.length === 0 && !ctx.result) {
      router.replace("/generate");
    }
  }, [isStreamingRoute, ctx.isStreaming, ctx.slides.length, ctx.result, router]);

  // Streaming mode: navigate to real URL when stream completes
  useEffect(() => {
    if (!isStreamingRoute || !ctx.result) return;
    router.replace(`/deck/${ctx.result.deal_id}`);
  }, [isStreamingRoute, ctx.result, router]);

  // Normal mode: fetch deck from API (skip if streaming or context has the data)
  const contextHasDeck =
    !isStreamingRoute &&
    ctx.result?.deal_id === dealId &&
    ctx.slides.length > 0;

  useEffect(() => {
    if (isStreamingRoute || contextHasDeck) return;
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
        setFetchedDeck(data.deck);
        setEvalData(data.eval);
        setFetching(false);
      })
      .catch((err) => {
        setFetchError(err.message);
        setFetching(false);
      });
  }, [session, dealId, isStreamingRoute, contextHasDeck]);

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  // Derive the active deck from available sources
  let activeDeck: Deck | null = null;
  let loading = false;

  if (isStreamingRoute) {
    if (ctx.slides.length > 0) {
      activeDeck = {
        deal_id: "streaming",
        company: ctx.company || "",
        slides: ctx.slides,
      };
    }
    // else: waiting for first slide (shown below)
  } else if (contextHasDeck) {
    activeDeck = {
      deal_id: dealId,
      company: ctx.company || "",
      slides: ctx.slides,
    };
  } else {
    activeDeck = fetchedDeck;
    loading = fetching;
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {isStreamingRoute && ctx.error && !ctx.isStreaming ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{ctx.error}</p>
            <button
              onClick={() => router.push("/generate")}
              className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <p className="text-neutral-500">Loading deck...</p>
        ) : fetchError ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{fetchError}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
            >
              Back to dashboard
            </button>
          </div>
        ) : isStreamingRoute && !activeDeck ? (
          <div className="flex items-center gap-2 text-neutral-500">
            <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Waiting for first slide...
          </div>
        ) : activeDeck ? (
          <DeckEditor
            initialDeck={activeDeck}
            existingEval={evalData}
            isStreaming={isStreamingRoute && ctx.isStreaming}
            stageMessage={isStreamingRoute ? ctx.stageMessage : null}
          />
        ) : null}
      </main>
    </div>
  );
}
