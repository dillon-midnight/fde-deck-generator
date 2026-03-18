// Two-model strategy: use the best model where quality determines outcomes,
// use the cheapest model where the task is binary and latency matters.
//
// GENERATION (Claude Sonnet): slide content is customer-facing and must be
// defensible. Sonnet has the strongest instruction-following for structured
// JSON output and the lowest hallucination rate on product knowledge tasks.
// Cost is secondary here — a bad deck loses deals.
//
// GROUNDING (Gemini Flash Lite): faithfulness evaluation is a binary
// pass/fail classification, not creative generation. Flash Lite handles this
// in ~200ms at ~1/20th the cost of Sonnet. Latency matters because grounding
// runs concurrently with generation in the consumer loop.
//
// FALLBACK CHAINS: ordered by capability, not cost. On a provider outage
// the system degrades gracefully rather than failing. OpenAI is deliberately
// excluded from both chains to avoid vendor concentration — if one hyperscaler
// has an incident, we want diversity, not a second dependency on the same
// ecosystem.
//
// ZDR (Zero Data Retention): required on every call. Enterprise prospects
// in regulated industries (financial services, healthcare, legal) will not
// sign off on AI tooling that logs their deal data to a third-party provider.
// This is a procurement blocker, not a nice-to-have.
export const GENERATION_MODEL = "anthropic/claude-sonnet-4-6";
export const GENERATION_PROVIDER_OPTIONS = {
  gateway: {
    zeroDataRetention: true,
    models: ["google/gemini-2.5-pro", "mistral/mistral-large-latest"],
  },
};

export const GROUNDING_MODEL = "google/gemini-2.0-flash-lite";
export const GROUNDING_PROVIDER_OPTIONS = {
  gateway: {
    zeroDataRetention: true,
    models: ["anthropic/claude-haiku-4-5", "groq/llama-3.3-70b-versatile"],
  },
};
