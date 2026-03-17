import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { SignalsSchema, type Signals, type Deck, type Slide } from "./schemas";
import { injectionDetected } from "./injection";
import { embedText } from "./embeddings";
import { vectorSearch } from "./rag";
import { checkAndRegenerate } from "./grounding";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { sql } from "./db";

export async function generateDeck(
  rawSignals: unknown,
  userId: string
): Promise<{ deck: Deck; pipelineRun: Record<string, unknown> }> {
  const startTime = Date.now();

  // Validate
  const signals = SignalsSchema.parse(rawSignals);

  // Injection check
  if (injectionDetected(signals)) {
    throw new Error("Injection detected in signals input");
  }

  // Embed the query
  const queryText = `${signals.company} ${signals.industry} ${signals.pain_points.join(" ")} ${signals.use_cases.join(" ")}`;
  const queryEmbedding = await embedText(queryText);

  // Retrieve chunks
  const chunks = await vectorSearch(queryEmbedding, "doc_chunks", 10);
  if (chunks.length === 0) {
    throw new Error("No chunks retrieved — cannot generate grounded deck");
  }

  // Retrieve few-shot examples (best-effort, don't fail)
  let fewShotExamples: { signals: Signals; deck: Deck; diff?: unknown }[] = [];
  try {
    const evalRows = await sql`
      SELECT transcript_signals, generated_deck, ae_diff
      FROM eval_tuples
      WHERE ae_diff IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 3
    `;
    fewShotExamples = (evalRows as any[]).map((row) => ({
      signals: row.transcript_signals,
      deck: row.generated_deck,
      diff: row.ae_diff,
    }));
  } catch {
    // No eval tuples yet, that's fine
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(signals, chunks, fewShotExamples);

  // Generate
  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 4096,
  });

  // Parse LLM output
  const parsed = JSON.parse(text);
  const dealId = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let deck: Deck = {
    deal_id: dealId,
    company: signals.company,
    slides: parsed.slides,
  };

  // Grounding loop
  const groundingResult = await checkAndRegenerate(deck, chunks, {
    generateSlide: async (slide: Slide) => {
      const { text: regenText } = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        system: systemPrompt,
        prompt: `Regenerate this slide to be grounded in the product knowledge. The sources MUST reference URLs from the provided chunks.\n\nSlide to fix:\n${JSON.stringify(slide)}\n\nAvailable chunks:\n${chunks.map((c) => `[source:${c.source_url}]\n${c.content}`).join("\n\n")}\n\nReturn a single JSON slide object.`,
        maxOutputTokens: 1024,
      });
      return JSON.parse(regenText);
    },
  });

  deck = groundingResult.deck;

  const latencyMs = Date.now() - startTime;
  const totalSlides = deck.slides.length;
  const faithfulnessRate =
    totalSlides > 0
      ? (totalSlides - groundingResult.slidesFailedGrounding) / totalSlides
      : 1;

  const pipelineRun = {
    deal_id: dealId,
    user_id: userId,
    signals,
    generated_deck: deck,
    retrieved_chunk_ids: chunks.map((c) => String(c.id)),
    retrieval_scores: chunks.map((c) => ({ id: c.id, score: c.score })),
    total_slides: totalSlides,
    slides_failed_grounding: groundingResult.slidesFailedGrounding,
    faithfulness_rate: faithfulnessRate,
    hallucination_check_iterations: groundingResult.iterations,
    latency_ms: latencyMs,
  };

  // Save pipeline run (best effort)
  try {
    await sql`
      INSERT INTO pipeline_runs (
        deal_id, user_id, signals, generated_deck, retrieved_chunk_ids,
        retrieval_scores, total_slides, slides_failed_grounding,
        faithfulness_rate, hallucination_check_iterations, latency_ms
      ) VALUES (
        ${pipelineRun.deal_id}, ${pipelineRun.user_id},
        ${JSON.stringify(pipelineRun.signals)}, ${JSON.stringify(pipelineRun.generated_deck)},
        ${pipelineRun.retrieved_chunk_ids}, ${JSON.stringify(pipelineRun.retrieval_scores)},
        ${pipelineRun.total_slides}, ${pipelineRun.slides_failed_grounding},
        ${pipelineRun.faithfulness_rate}, ${pipelineRun.hallucination_check_iterations},
        ${pipelineRun.latency_ms}
      )
    `;
  } catch {
    // Log but don't fail
    console.error("Failed to save pipeline run");
  }

  return { deck, pipelineRun };
}
