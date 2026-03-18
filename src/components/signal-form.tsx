"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TagInput } from "./tag-input";
import { useDeckStream } from "@/hooks/use-deck-stream";

const PRESETS = [
  {
    label: "Acme Corp — Financial Services",
    company: "Acme Corp",
    industry: "Financial Services",
    painPoints: ["Manual compliance reporting", "Scattered internal docs"],
    useCases: ["AI-powered compliance search", "Automated report generation"],
    objections: ["Data security concerns", "Regulatory risk"],
    tools: ["Salesforce", "Confluence"],
  },
  {
    label: "Globex — Healthcare",
    company: "Globex",
    industry: "Healthcare",
    painPoints: ["Slow clinical trial data retrieval", "Siloed research databases"],
    useCases: ["Cross-study search", "Evidence summarization"],
    objections: ["HIPAA compliance", "Integration complexity"],
    tools: ["Epic", "SharePoint"],
  },
  {
    label: "Initech — Legal",
    company: "Initech",
    industry: "Legal",
    painPoints: ["Time-consuming contract review", "Inconsistent clause tracking"],
    useCases: ["AI contract analysis", "Clause library search"],
    objections: ["Attorney-client privilege", "Accuracy requirements"],
    tools: ["iManage", "NetDocuments"],
  },
];

export function SignalForm() {
  const router = useRouter();
  const { slides, stageMessage, error, isStreaming, result, startStream } =
    useDeckStream();

  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [useCases, setUseCases] = useState<string[]>([]);
  const [objections, setObjections] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);

  // Auto-navigate on completion
  useEffect(() => {
    if (!result) return;
    const timeout = setTimeout(() => {
      router.push(`/deck/${result.deal_id}`);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [result, router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startStream({
      company,
      industry,
      pain_points: painPoints,
      use_cases: useCases,
      objections,
      tools,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Preset scenario</label>
        <select
          onChange={(e) => {
            const idx = Number(e.target.value);
            if (idx === -1) {
              setCompany("");
              setIndustry("");
              setPainPoints([]);
              setUseCases([]);
              setObjections([]);
              setTools([]);
            } else {
              const p = PRESETS[idx];
              setCompany(p.company);
              setIndustry(p.industry);
              setPainPoints(p.painPoints);
              setUseCases(p.useCases);
              setObjections(p.objections);
              setTools(p.tools);
            }
          }}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm"
          defaultValue={-1}
        >
          <option value={-1}>Custom</option>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Company *</label>
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          required
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm"
          placeholder="Acme Corp"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Industry *</label>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          required
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm"
          placeholder="Financial Services"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Pain Points *</label>
        <TagInput
          value={painPoints}
          onChange={setPainPoints}
          placeholder="Type a pain point and press Enter"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Use Cases *</label>
        <TagInput
          value={useCases}
          onChange={setUseCases}
          placeholder="Type a use case and press Enter"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Objections</label>
        <TagInput
          value={objections}
          onChange={setObjections}
          placeholder="Type an objection and press Enter"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Existing Tools</label>
        <TagInput
          value={tools}
          onChange={setTools}
          placeholder="Type a tool name and press Enter"
        />
      </div>

      <button
        type="submit"
        disabled={isStreaming}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors cursor-pointer"
      >
        {isStreaming ? "Generating deck..." : "Generate deck"}
      </button>

      {/* Streaming progress */}
      {(isStreaming || slides.length > 0 || result) && (
        <div className="mt-6 space-y-4">
          {/* Stage indicator */}
          {isStreaming && stageMessage && (
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              {stageMessage}
            </div>
          )}

          {/* Slide list */}
          {slides.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Slides ({slides.length})
              </h3>
              <ul className="space-y-1">
                {slides.map((slide, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm px-3 py-2 bg-neutral-50 dark:bg-neutral-800 rounded-lg"
                  >
                    <span>
                      <span className="text-neutral-400 mr-2">{i + 1}.</span>
                      {slide.title}
                    </span>
                    {slide.grounding_status === "grounded" && (
                      <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
                        Grounded
                      </span>
                    )}
                    {slide.grounding_status === "needs_review" && (
                      <span className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-2 py-0.5 rounded-full">
                        Needs review
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Completion */}
          {result && (
            <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg text-sm space-y-2">
              <p className="text-green-700 dark:text-green-300 font-medium">
                Deck generated — {Math.round(result.faithfulness_rate * 100)}%
                faithfulness
              </p>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs">
                Redirecting to deck editor...
              </p>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
