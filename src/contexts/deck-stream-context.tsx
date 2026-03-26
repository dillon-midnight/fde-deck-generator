// ARCHITECTURE: SSE stream + URL-driven state (replaces DB polling).
//
// The previous implementation polled /api/decks/workflow-status every 2s,
// introducing up to 2s latency per slide. This version:
//
// 1. startGeneration() POSTs to /api/decks/generate-workflow, gets a run_id,
//    and the caller navigates to /deck/{run_id}. The URL is the source of truth.
//
// 2. connectToStream(runId) first fetches /api/decks/workflow-status for a
//    one-time DB snapshot (handles page refresh mid-generation), then opens
//    a native workflow stream via /api/decks/workflow-stream for real-time
//    updates. Slides appear instantly as they are grounded, not on a 2s poll.
//
// 3. Reconnection: if the stream drops, the client retries with
//    slide_start_index = current slides length. The Redis-backed stream
//    guarantees no data loss. Exponential backoff (1s, 2s, 4s) with max
//    3 retries before the state remains on the last DB snapshot.
//
// 4. DB writes are still kept in the workflow steps — they power the dashboard
//    and serve as the persistence layer for completed decks.
//
// Multi-tab works naturally: each tab has its own URL with its own run_id.
// No singleton stream, no cross-tab conflicts.
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
  connectToStream: (runId: string) => void;
  disconnect: () => void;
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

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startGeneration = useCallback(
    async (signals: Record<string, unknown>): Promise<{ run_id: string }> => {
      disconnect();

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
    [disconnect]
  );

  const connectToStream = useCallback(
    (runId: string) => {
      disconnect();

      const controller = new AbortController();
      abortRef.current = controller;

      async function run() {
        // Step 1: Rehydrate from DB snapshot
        let snapshot: WorkflowStatus;
        try {
          const res = await fetch(
            `/api/decks/workflow-status?run_id=${encodeURIComponent(runId)}`,
            { signal: controller.signal }
          );
          if (!res.ok) {
            if (res.status === 404) {
              setState((s) => ({ ...s, error: "Run not found", isStreaming: false }));
            }
            return;
          }
          snapshot = await res.json();
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          return;
        }

        // Apply snapshot state
        setState((s) => ({
          ...s,
          slides: snapshot.slides,
          stage: snapshot.status,
          stageMessage: snapshot.status_message,
          error: snapshot.error,
          isStreaming: snapshot.status !== "complete" && snapshot.status !== "error",
          result:
            snapshot.status === "complete" && snapshot.deal_id
              ? {
                  deal_id: snapshot.deal_id,
                  faithfulness_rate: snapshot.faithfulness_rate ?? 1,
                }
              : s.result,
        }));

        // If already terminal, no stream needed
        if (snapshot.status === "complete" || snapshot.status === "error") {
          return;
        }

        // Step 2: Open native workflow stream
        if (!snapshot.workflow_run_id) {
          // workflow_run_id not yet available — fall back to polling briefly
          // This can happen if the page loads before start() returns
          setTimeout(() => {
            if (!controller.signal.aborted) {
              run();
            }
          }, 1000);
          return;
        }

        const slideStartIndex = snapshot.slides.length;
        await openStream(
          runId,
          snapshot.workflow_run_id,
          slideStartIndex,
          controller,
          0
        );
      }

      async function openStream(
        runId: string,
        workflowRunId: string,
        slideStartIndex: number,
        controller: AbortController,
        retryCount: number
      ) {
        try {
          const res = await fetch(
            `/api/decks/workflow-stream?run_id=${encodeURIComponent(runId)}&workflow_run_id=${encodeURIComponent(workflowRunId)}&slide_start_index=${slideStartIndex}`,
            { signal: controller.signal }
          );

          if (!res.ok || !res.body) {
            throw new Error(`Stream HTTP ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            let currentEvent = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith("data: ") && currentEvent) {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(currentEvent, data);
                currentEvent = "";
              }
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;

          // Retry with exponential backoff
          if (retryCount < 3) {
            const delay = 1000 * Math.pow(2, retryCount);
            await new Promise((r) => setTimeout(r, delay));
            if (controller.signal.aborted) return;

            // Get current slide count for startIndex
            let currentSlideCount = slideStartIndex;
            setState((s) => {
              currentSlideCount = s.slides.length;
              return s;
            });

            await openStream(runId, workflowRunId, currentSlideCount, controller, retryCount + 1);
          }
          // After max retries, state remains on last snapshot — no further action
        }
      }

      function handleSSEEvent(event: string, data: Record<string, unknown>) {
        if (event === "slide") {
          setState((s) => ({
            ...s,
            slides: [...s.slides, data as unknown as Slide],
          }));
        } else if (event === "status") {
          const status = data.status as string;
          const message = data.message as string;

          if (status === "complete") {
            setState((s) => ({
              ...s,
              stage: status,
              stageMessage: message,
              isStreaming: false,
              result: {
                deal_id: data.deal_id as string,
                faithfulness_rate: data.faithfulness_rate as number,
              },
            }));
          } else {
            setState((s) => ({
              ...s,
              stage: status,
              stageMessage: message,
            }));
          }
        }
      }

      run();
    },
    [disconnect]
  );

  const clearStream = useCallback(() => {
    disconnect();
    setState(initialState);
  }, [disconnect]);

  return (
    <DeckStreamContext.Provider
      value={{ ...state, startGeneration, connectToStream, disconnect, clearStream }}
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
