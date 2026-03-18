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
