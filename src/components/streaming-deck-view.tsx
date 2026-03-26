// RENDERING STRATEGY: Client Component that consumes a native workflow stream.
//
// The URL contains the run_id (e.g., /deck/run-123456-abc), so page refreshes
// work: on mount, connectToStream(runId) fetches a DB snapshot for rehydration,
// then opens a native workflow stream for real-time slide and status updates.
// When the workflow completes, we navigate to the permanent /deck/{deal_id} URL.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { DeckEditor } from "@/components/deck-editor";
import { useDeckStreamContext } from "@/contexts/deck-stream-context";
import type { Deck } from "@/lib/schemas";

interface StreamingDeckViewProps {
  runId?: string;
}

export function StreamingDeckView({ runId }: StreamingDeckViewProps) {
  const router = useRouter();
  const ctx = useDeckStreamContext();

  // Connect to stream when mounted with a runId
  useEffect(() => {
    if (runId) {
      ctx.connectToStream(runId);
    }
    return () => {
      ctx.disconnect();
    };
    // Only run on mount / when runId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Redirect to /generate if no runId and no active state
  useEffect(() => {
    if (!runId && !ctx.isStreaming && ctx.slides.length === 0 && !ctx.result) {
      router.replace("/generate");
    }
  }, [runId, ctx.isStreaming, ctx.slides.length, ctx.result, router]);

  // Navigate to permanent URL when workflow completes
  useEffect(() => {
    if (ctx.result) {
      router.replace(`/deck/${ctx.result.deal_id}`);
    }
  }, [ctx.result, router]);

  // Build the active deck from stream state
  let activeDeck: Deck | null = null;
  if (ctx.slides.length > 0) {
    activeDeck = {
      deal_id: runId || "streaming",
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
            {ctx.stageMessage || "Waiting for first slide..."}
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
