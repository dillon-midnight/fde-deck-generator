"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { exportToGoogleSlides } from "@/lib/google-slides";
import type { Deck } from "@/lib/schemas";

interface ExportButtonProps {
  deck: Deck;
}

export function ExportButton({ deck }: ExportButtonProps) {
  const { data: session } = useSession();
  const [exporting, setExporting] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    const accessToken = (session as any)?.accessToken;
    if (!accessToken) {
      setError("No Google access token. Please sign in again.");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const presentationUrl = await exportToGoogleSlides(deck, accessToken);
      setUrl(presentationUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleExport}
        disabled={exporting}
        className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer"
      >
        {exporting ? "Exporting..." : "Export to Google Slides"}
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:text-blue-700 underline"
        >
          Open presentation
        </a>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
