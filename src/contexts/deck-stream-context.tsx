// ARCHITECTURE: Polling + URL-driven state (replaces SSE streaming).
//
// The previous implementation held all generation state in a single SSE
// connection. If the browser refreshed, the connection dropped and all
// state was lost. This version:
//
// 1. startGeneration() POSTs to /api/decks/generate-workflow, gets a run_id,
//    and the caller navigates to /deck/{run_id}. The URL is the source of truth.
//
// 2. pollRun(runId) polls /api/decks/workflow-status every 2s and updates
//    React state from the server-authoritative response. If the user refreshes,
//    the page re-reads runId from the URL and calls pollRun() again — state
//    rehydrates from the DB.
//
// 3. Multi-tab works naturally: each tab has its own URL with its own run_id.
//    No singleton stream, no cross-tab conflicts.
//
// No localStorage or client-side persistence is used. The URL (for the deck
// page) and the server (for the dashboard) are the only sources of truth.
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
import type { Slide, WorkflowStatus } from "@/lib/schemas";

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
  startGeneration: (signals: Record<string, unknown>) => Promise<{ run_id: string }>;
  pollRun: (runId: string) => void;
  stopPolling: () => void;
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startGeneration = useCallback(
    async (signals: Record<string, unknown>): Promise<{ run_id: string }> => {
      stopPolling();
      abortRef.current?.abort();

      const company =
        typeof signals.company === "string" ? signals.company : null;

      setState({
        ...initialState,
        company,
        isStreaming: true,
        stage: "pending",
        stageMessage: "Starting...",
      });

      const res = await fetch("/api/decks/generate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signals),
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
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { run_id } = await res.json();
      return { run_id };
    },
    [stopPolling]
  );

  const pollRun = useCallback(
    (runId: string) => {
      // Stop any existing poll
      stopPolling();

      const controller = new AbortController();
      abortRef.current = controller;

      async function fetchStatus() {
        try {
          const res = await fetch(
            `/api/decks/workflow-status?run_id=${encodeURIComponent(runId)}`,
            { signal: controller.signal }
          );
          if (!res.ok) {
            if (res.status === 404) {
              setState((s) => ({
                ...s,
                error: "Run not found",
                isStreaming: false,
              }));
              stopPolling();
              return;
            }
            return; // transient error, retry on next poll
          }

          const data: WorkflowStatus = await res.json();

          setState((s) => ({
            ...s,
            slides: data.slides,
            stage: data.status,
            stageMessage: data.status_message,
            error: data.error,
            isStreaming:
              data.status !== "complete" && data.status !== "error",
            result:
              data.status === "complete" && data.deal_id
                ? {
                    deal_id: data.deal_id,
                    faithfulness_rate: data.faithfulness_rate ?? 1,
                  }
                : s.result,
          }));

          if (data.status === "complete" || data.status === "error") {
            stopPolling();
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }

      // Fetch immediately, then poll every 2s
      fetchStatus();
      pollingRef.current = setInterval(fetchStatus, 2000);
    },
    [stopPolling]
  );

  const clearStream = useCallback(() => {
    stopPolling();
    abortRef.current?.abort();
    setState(initialState);
  }, [stopPolling]);

  return (
    <DeckStreamContext.Provider
      value={{ ...state, startGeneration, pollRun, stopPolling, clearStream }}
    >
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
