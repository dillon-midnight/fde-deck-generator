"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TagInput } from "./tag-input";
import { useDeckStreamContext } from "@/contexts/deck-stream-context";

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
  const { error, startGeneration } = useDeckStreamContext();

  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [useCases, setUseCases] = useState<string[]>([]);
  const [objections, setObjections] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Navigate to /deck/{run_id} after starting the workflow.
  // The run_id is in the URL so refreshing the page rehydrates from the DB.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { run_id } = await startGeneration({
        company,
        industry,
        pain_points: painPoints,
        use_cases: useCases,
        objections,
        tools,
      });
      router.push(`/deck/${run_id}`);
    } catch {
      // Error is surfaced via context state
      setSubmitting(false);
    }
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
        disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors cursor-pointer disabled:cursor-default"
      >
        {submitting ? "Starting..." : "Generate deck"}
      </button>
    </form>
  );
}
