"use client";

import { useState } from "react";
import PptxGenJS from "pptxgenjs";
import type { Deck } from "@/lib/schemas";

interface ExportButtonProps {
  deck: Deck;
  disabled?: boolean;
}

export function ExportButton({ deck, disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decision: Client-side PPTX generation via pptxgenjs instead of Google
  // Slides API. Google Drive/Slides OAuth scopes require Google's app
  // verification process (weeks-long), which blocks deployment. A .pptx
  // download avoids the OAuth scope requirement entirely — users can manually
  // import into Google Slides if needed.
  async function handleExport() {
    setExporting(true);
    setError(null);

    try {
      const pptx = new PptxGenJS();
      pptx.title = `${deck.company} — Technical Solution Deck`;

      for (const slide of deck.slides) {
        const pptxSlide = pptx.addSlide();

        pptxSlide.addText(slide.title, {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 1,
          fontSize: 24,
          bold: true,
        });

        const bodyText = [
          ...slide.talking_points.map((tp) => `• ${tp}`),
          "",
          `Features: ${slide.features.join(", ")}`,
          "",
          `Sources: ${slide.sources.join(", ")}`,
        ].join("\n");

        pptxSlide.addText(bodyText, {
          x: 0.5,
          y: 1.75,
          w: 9,
          h: 4.5,
          fontSize: 14,
          valign: "top",
        });
      }

      await pptx.writeFile({
        fileName: `${deck.company} - Technical Solution Deck.pptx`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleExport}
        disabled={exporting || disabled}
        className="bg-green-600 enabled:hover:bg-green-700 disabled:opacity-50 disabled:cursor-default text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors cursor-pointer"
      >
        {exporting ? "Generating..." : "Download .pptx"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
