"use client";

import { useState, useEffect, useRef } from "react";
import type { Deck, Slide } from "@/lib/schemas";
import { SlideCard } from "./slide-card";
import { ExportButton } from "./export-button";

interface DeckEditorProps {
  initialDeck: Deck;
  existingEval?: { ae_diff: unknown; edited_deck: Deck } | null;
  isStreaming?: boolean;
  stageMessage?: string | null;
}

export function DeckEditor({
  initialDeck,
  existingEval,
  isStreaming,
  stageMessage,
}: DeckEditorProps) {
  const [editedDeck, setEditedDeck] = useState<Deck>(
    existingEval?.edited_deck || initialDeck
  );
  const [currentSlide, setCurrentSlide] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existingEval);
  const [error, setError] = useState<string | null>(null);
  const prevStreamingRef = useRef(isStreaming);

  // Append new slides from stream without overwriting user edits
  useEffect(() => {
    if (!isStreaming) return;
    setEditedDeck((prev) => {
      const newSlides = initialDeck.slides.slice(prev.slides.length);
      if (newSlides.length === 0) return prev;
      return { ...prev, slides: [...prev.slides, ...newSlides] };
    });
  }, [isStreaming, initialDeck.slides]);

  // When streaming finishes, update deal_id from the real deck
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setEditedDeck((prev) => ({
        ...prev,
        deal_id: initialDeck.deal_id,
        company: initialDeck.company,
      }));
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, initialDeck.deal_id, initialDeck.company]);

  function updateSlide(idx: number, updated: Slide) {
    const newSlides = [...editedDeck.slides];
    newSlides[idx] = updated;
    setEditedDeck({ ...editedDeck, slides: newSlides });
    setSaved(false);
  }

  async function saveFeedback() {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/decks/deals/${editedDeck.deal_id}/eval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edited_deck: editedDeck }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save feedback");
      }

      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const total = editedDeck.slides.length;
  const streamingInProgress = !!isStreaming;

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {editedDeck.company || "Generating..."}
            </h1>
            {streamingInProgress && (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                {stageMessage}
              </div>
            )}
          </div>
          <p className="text-sm text-neutral-500">
            {total} slide{total !== 1 ? "s" : ""}
            {streamingInProgress
              ? " · generating..."
              : ` · Deal ${editedDeck.deal_id.slice(0, 12)}...`}
          </p>
        </div>
        <ExportButton deck={editedDeck} disabled={streamingInProgress} />
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Slide editor */}
      {total > 0 && (
        <SlideCard
          slide={editedDeck.slides[currentSlide]}
          onChange={(updated) => updateSlide(currentSlide, updated)}
        />
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
            disabled={currentSlide === 0}
            className="px-3 py-1.5 text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            Prev
          </button>
          <span className="text-sm text-neutral-500">
            {currentSlide + 1} / {total}
            {streamingInProgress ? " · generating..." : ""}
          </span>
          <button
            onClick={() =>
              setCurrentSlide(Math.min(total - 1, currentSlide + 1))
            }
            disabled={currentSlide >= total - 1}
            className="px-3 py-1.5 text-sm border border-neutral-300 dark:border-neutral-700 rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-default"
          >
            Next
          </button>
        </div>
        <button
          onClick={saveFeedback}
          disabled={saving || saved || streamingInProgress}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-default ${
            saved
              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
              : "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white"
          }`}
        >
          {saving
            ? "Saving..."
            : saved
            ? "Feedback saved"
            : "Save feedback"}
        </button>
      </div>
    </div>
  );
}
