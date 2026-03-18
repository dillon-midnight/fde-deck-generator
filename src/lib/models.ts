export const GENERATION_MODEL = "anthropic/claude-sonnet-4-6";
export const GENERATION_FALLBACKS = {
  gateway: {
    models: ["google/gemini-2.5-pro", "openai/gpt-4.1"],
  },
};

export const GROUNDING_MODEL = "google/gemini-2.0-flash-lite";
export const GROUNDING_FALLBACKS = {
  gateway: {
    models: ["openai/gpt-4.1-mini", "anthropic/claude-haiku-4-5"],
  },
};
