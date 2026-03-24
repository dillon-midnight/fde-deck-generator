// Dashboard deck list with live SSE updates for in-progress workflow runs.
//
// Receives an initial list of decks from the server component (SSR'd) and
// subscribes to /api/decks/dashboard-stream for real-time updates. When a
// run's slide count changes or a run completes, the list updates without a
// page refresh.
//
// In-progress items show a "Generating" badge, a live slide count, and a
// spinner. When a run completes, the item transitions to a full deck card
// with the permanent /deck/{deal_id} link.
"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

export interface DeckListItem {
  deal_id: string | null;
  run_id: string | null;
  company: string;
  timestamp: string;
  total_slides: number;
  eval_status: string;
  status?: string;
}

interface DashboardUpdate {
  type: "update";
  runs: {
    run_id: string;
    status: string;
    company: string;
    slides_count: number;
    deal_id: string | null;
  }[];
}

export function DeckList({ initialDecks }: { initialDecks: DeckListItem[] }) {
  const [decks, setDecks] = useState<DeckListItem[]>(initialDecks);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasActiveRuns = initialDecks.some(
    (d) => d.status === "Generating"
  );

  useEffect(() => {
    // Only connect SSE if there are in-progress runs
    if (!hasActiveRuns) return;

    const es = new EventSource("/api/decks/dashboard-stream");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: DashboardUpdate = JSON.parse(event.data);
        if (data.type !== "update") return;

        setDecks((prev) => {
          const updated = [...prev];

          for (const run of data.runs) {
            const existingIdx = updated.findIndex(
              (d) => d.run_id === run.run_id
            );

            if (run.status === "complete" && run.deal_id) {
              // Run completed: update the item with permanent deal_id
              if (existingIdx >= 0) {
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  deal_id: run.deal_id,
                  total_slides: run.slides_count,
                  eval_status: "Pending review",
                  status: undefined,
                };
              }
            } else if (run.status === "error") {
              if (existingIdx >= 0) {
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  status: "Error",
                  eval_status: "Error",
                };
              }
            } else {
              // In-progress: update slide count
              if (existingIdx >= 0) {
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  total_slides: run.slides_count,
                  company: run.company,
                };
              }
            }
          }

          return updated;
        });
      } catch {
        // malformed event, ignore
      }
    };

    es.onerror = () => {
      // SSE connection dropped — will auto-reconnect or stay closed
      // if the server closed it (no active runs)
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [hasActiveRuns]);

  if (decks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500 mb-4">No decks generated yet.</p>
        <Link
          href="/generate"
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          Generate your first deck
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {decks.map((deal) => {
        const isGenerating = deal.status === "Generating";
        const isError = deal.status === "Error";
        const href = isGenerating && deal.run_id
          ? `/deck/${deal.run_id}`
          : deal.deal_id
            ? `/deck/${deal.deal_id}`
            : "#";

        return (
          <Link
            key={deal.run_id || deal.deal_id}
            href={href}
            className="block p-4 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{deal.company || "Unknown"}</p>
                <p className="text-sm text-neutral-500">
                  {deal.timestamp
                    ? new Date(deal.timestamp).toLocaleDateString()
                    : "Just now"}{" "}
                  ·{" "}
                  {isGenerating
                    ? `${deal.total_slides} slides so far...`
                    : `${deal.total_slides} slides`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isGenerating && (
                  <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
                <span
                  className={`text-xs font-medium px-2 py-1 rounded ${
                    isGenerating
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                      : isError
                        ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                        : deal.eval_status === "Reviewed"
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                  }`}
                >
                  {isGenerating
                    ? "Generating..."
                    : isError
                      ? "Error"
                      : deal.eval_status}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
