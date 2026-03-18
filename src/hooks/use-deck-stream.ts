"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Slide, StreamEvent } from "@/lib/schemas";

interface DeckStreamState {
  slides: Slide[];
  stage: string | null;
  stageMessage: string | null;
  error: string | null;
  isStreaming: boolean;
  result: { deal_id: string; faithfulness_rate: number } | null;
}

export function useDeckStream() {
  const [state, setState] = useState<DeckStreamState>({
    slides: [],
    stage: null,
    stageMessage: null,
    error: null,
    isStreaming: false,
    result: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startStream = useCallback((signals: Record<string, unknown>) => {
    // Abort any in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state
    setState({
      slides: [],
      stage: null,
      stageMessage: null,
      error: null,
      isStreaming: true,
      result: null,
    });

    (async () => {
      try {
        const res = await fetch("/api/decks/generate-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signals),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Request failed" }));
          setState((s) => ({
            ...s,
            error: data.error || `HTTP ${res.status}`,
            isStreaming: false,
          }));
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop()!; // Keep incomplete chunk

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const json = trimmed.slice(6);
            let event: StreamEvent;
            try {
              event = JSON.parse(json);
            } catch {
              continue;
            }

            switch (event.type) {
              case "stage":
                setState((s) => ({
                  ...s,
                  stage: event.stage,
                  stageMessage: event.message,
                }));
                break;
              case "slide":
                setState((s) => ({
                  ...s,
                  slides: [...s.slides, event.slide],
                }));
                break;
              case "complete":
                setState((s) => ({
                  ...s,
                  result: {
                    deal_id: event.deal_id,
                    faithfulness_rate: event.faithfulness_rate,
                  },
                  isStreaming: false,
                }));
                break;
              case "error":
                setState((s) => ({
                  ...s,
                  error: event.message,
                  isStreaming: false,
                }));
                break;
            }
          }
        }

        // Stream ended without complete event
        setState((s) => (s.isStreaming ? { ...s, isStreaming: false } : s));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : "Stream failed",
          isStreaming: false,
        }));
      }
    })();
  }, []);

  return { ...state, startStream };
}
