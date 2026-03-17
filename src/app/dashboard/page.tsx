"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/nav";

interface Deal {
  deal_id: string;
  signals: { company: string };
  timestamp: string;
  total_slides: number;
  faithfulness_rate: number;
  eval_status: string;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/deals")
      .then((r) => r.json())
      .then((data) => {
        setDeals(data.deals || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session]);

  if (status === "loading" || !session) {
    return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Decks</h1>
          <Link
            href="/generate"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            New deck
          </Link>
        </div>

        {loading ? (
          <p className="text-neutral-500">Loading...</p>
        ) : deals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-neutral-500 mb-4">No decks generated yet.</p>
            <Link
              href="/generate"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Generate your first deck
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {deals.map((deal) => (
              <Link
                key={deal.deal_id}
                href={`/deck/${deal.deal_id}`}
                className="block p-4 border border-neutral-200 dark:border-neutral-800 rounded-lg hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{deal.signals?.company || deal.deal_id}</p>
                    <p className="text-sm text-neutral-500">
                      {new Date(deal.timestamp).toLocaleDateString()} · {deal.total_slides} slides
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded ${
                      deal.eval_status === "Reviewed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    }`}
                  >
                    {deal.eval_status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
