// RENDERING STRATEGY: Client Component extracted from /deck/[deal_id]/page.tsx
// to keep the page itself a Server Component. SSE streams (Server-Sent Events)
// require client-side rendering — the browser holds open the connection and
// pushes slide data into React state on each event. This component owns all
// streaming logic so the parent page can server-render saved decks without
// shipping any of this JS.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { DeckEditor } from "@/components/deck-editor";
import { useDeckStreamContext } from "@/contexts/deck-stream-context";
import type { Deck } from "@/lib/schemas";

export function StreamingDeckView() {
  const router = useRouter();
  const ctx = useDeckStreamContext();

  // Redirect to /generate if no active stream
  useEffect(() => {
    if (!ctx.isStreaming && ctx.slides.length === 0 && !ctx.result) {
      router.replace("/generate");
    }
  }, [ctx.isStreaming, ctx.slides.length, ctx.result, router]);

  // Navigate to real URL when stream completes
  useEffect(() => {
    if (ctx.result) {
      router.replace(`/deck/${ctx.result.deal_id}`);
    }
  }, [ctx.result, router]);

  // Build the active deck from stream state
  let activeDeck: Deck | null = null;
  if (ctx.slides.length > 0) {
    activeDeck = {
      deal_id: "streaming",
      company: ctx.company || "",
      slides: ctx.slides,
    };
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {ctx.error && !ctx.isStreaming ? (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{ctx.error}</p>
            <button
              onClick={() => router.push("/generate")}
              className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : !activeDeck ? (
          <div className="flex items-center gap-2 text-neutral-500">
            <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Waiting for first slide...
          </div>
        ) : (
          <DeckEditor
            initialDeck={activeDeck}
            isStreaming={ctx.isStreaming}
            stageMessage={ctx.stageMessage}
          />
        )}
      </main>
    </div>
  );
}
