"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Slide, StreamEvent } from "@/lib/schemas";

interface DeckStreamState {
  slides: Slide[];
  company: string | null;
  stage: string | null;
  stageMessage: string | null;
  error: string | null;
  isStreaming: boolean;
  result: { deal_id: string; faithfulness_rate: number } | null;
}

interface DeckStreamContextValue extends DeckStreamState {
  startStream: (signals: Record<string, unknown>) => void;
  clearStream: () => void;
}

const initialState: DeckStreamState = {
  slides: [],
  company: null,
  stage: null,
  stageMessage: null,
  error: null,
  isStreaming: false,
  result: null,
};

const DeckStreamContext = createContext<DeckStreamContextValue | null>(null);

export function DeckStreamProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeckStreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const startStream = useCallback((signals: Record<string, unknown>) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const company = typeof signals.company === "string" ? signals.company : null;

    setState({
      ...initialState,
      company,
      isStreaming: true,
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
          const data = await res
            .json()
            .catch(() => ({ error: "Request failed" }));
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

          if (!done) {
            buffer += decoder.decode(value, { stream: true });
          } else {
            buffer += decoder.decode(); // flush decoder
          }
          const lines = buffer.split("\n\n");
          buffer = lines.pop()!;

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

          if (done) break;
        }

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

  const clearStream = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  return (
    <DeckStreamContext.Provider value={{ ...state, startStream, clearStream }}>
      {children}
    </DeckStreamContext.Provider>
  );
}

export function useDeckStreamContext() {
  const ctx = useContext(DeckStreamContext);
  if (!ctx) {
    throw new Error(
      "useDeckStreamContext must be used within a DeckStreamProvider"
    );
  }
  return ctx;
}
