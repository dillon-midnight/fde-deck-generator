import { streamText, generateText, Output } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import {
  SignalsSchema,
  SlideSchema,
  type Signals,
  type Slide,
  type Deck,
  type StreamEvent,
} from "./schemas";
import { injectionDetected } from "./injection";
import { embedText } from "./embeddings";
import { vectorSearch } from "./rag";
import { groundSlide, type GroundingChunk } from "./grounding";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { sql } from "./db";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("fde-deck-generator");

function isCompleteSlide(s: unknown): s is Slide {
  return (
    !!s &&
    typeof s === "object" &&
    "slide_number" in s &&
    "title" in s &&
    "talking_points" in s &&
    "features" in s &&
    "sources" in s &&
    Array.isArray((s as Slide).talking_points) &&
    Array.isArray((s as Slide).sources)
  );
}

export async function generateDeckStream(
  rawSignals: unknown,
  userId: string,
  emit: (event: StreamEvent) => void
): Promise<void> {
  const startTime = Date.now();

  // Validate (throws before stream — caught by route as HTTP error)
  const signals = SignalsSchema.parse(rawSignals);
  if (injectionDetected(signals)) {
    throw new Error("Injection detected in signals input");
  }

  try {
    emit({ type: "stage", stage: "retrieval", message: "Retrieving product knowledge..." });

    // Embed & retrieve
    const queryText = `${signals.company} ${signals.industry} ${signals.pain_points.join(" ")} ${signals.use_cases.join(" ")}`;
    const queryEmbedding = await embedText(queryText);
    const chunks = await vectorSearch(queryEmbedding, "doc_chunks", 10);
    if (chunks.length === 0) {
      emit({ type: "error", message: "No chunks retrieved — cannot generate grounded deck" });
      return;
    }

    // Few-shot examples (best effort)
    let fewShotExamples: { signals: Signals; deck: Deck; diff?: unknown }[] = [];
    try {
      const evalRows = await sql`
        SELECT transcript_signals, generated_deck, ae_diff
        FROM eval_tuples
        WHERE ae_diff IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 3
      `;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fewShotExamples = (evalRows as any[]).map((row) => ({
        signals: row.transcript_signals,
        deck: row.generated_deck,
        diff: row.ae_diff,
      }));
    } catch {
      // No eval tuples yet
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(signals, chunks, fewShotExamples);

    emit({ type: "stage", stage: "generation", message: "Generating slides..." });

    // Slide queue for producer/consumer
    const slideQueue: Slide[] = [];
    let producerDone = false;
    let resolveWait: (() => void) | null = null;

    function notify() {
      resolveWait?.();
    }

    async function waitForSlide(): Promise<Slide | null> {
      while (slideQueue.length === 0) {
        if (producerDone) return null;
        await new Promise<void>((r) => {
          resolveWait = r;
        });
        resolveWait = null;
      }
      return slideQueue.shift()!;
    }

    const groundedSlides: Slide[] = [];
    let slidesFailedGrounding = 0;

    // Grounding callbacks using Gemini Flash Lite
    function makeEvaluateSlide(evalChunks: GroundingChunk[]) {
      return async (slide: Slide, _chunks: GroundingChunk[]) => {
        const { output } = await generateText({
          model: gateway("google/gemini-2.0-flash-lite"),
          output: Output.object({
            schema: z.object({
              slide_number: z.number(),
              grounded: z.boolean(),
              reason: z.string(),
            }),
          }),
          system:
            "You are a faithfulness evaluator. Evaluate whether the slide's talking_points and features are supported by the source chunk content. A slide is grounded if its claims are substantiated by the chunk text, not just if it references a valid URL.",
          prompt: `Evaluate this slide for faithfulness against the source chunks.\n\nSlide:\n${JSON.stringify(slide, null, 2)}\n\nSource chunks:\n${evalChunks.map((c) => `[source:${c.source_url}]\n${c.content}`).join("\n\n")}\n\nReturn whether it is grounded and a brief reason.`,
          maxOutputTokens: 512,
        });
        return output!;
      };
    }

    function makeRegenerateSlide(regenChunks: GroundingChunk[]) {
      return async (slide: Slide, _chunks: GroundingChunk[]) => {
        const { output } = await generateText({
          model: gateway("google/gemini-2.0-flash-lite"),
          output: Output.object({ schema: SlideSchema }),
          system: systemPrompt,
          prompt: `Regenerate this slide to be grounded in the product knowledge. The sources MUST reference URLs from the provided chunks.\n\nSlide to fix:\n${JSON.stringify(slide)}\n\nAvailable chunks:\n${regenChunks.map((c) => `[source:${c.source_url}]\n${c.content}`).join("\n\n")}\n\nReturn a single JSON slide object.`,
          maxOutputTokens: 1024,
        });
        return output!;
      };
    }

    const evaluateSlide = makeEvaluateSlide(chunks);
    const regenerateSlide = makeRegenerateSlide(chunks);

    // Producer/Consumer
    await Promise.all([
      // PRODUCER: Claude Sonnet via streamText
      (async () => {
        const generateSpan = tracer.startSpan("llm-generate-deck-stream");
        generateSpan.setAttributes({
          "llm.model": "anthropic/claude-sonnet-4-6",
          "deck.company": signals.company,
        });
        try {
          const result = streamText({
            model: gateway("anthropic/claude-sonnet-4-6"),
            output: Output.object({
              schema: z.object({ slides: z.array(SlideSchema) }),
            }),
            system: systemPrompt,
            prompt: userPrompt,
            maxOutputTokens: 4096,
          });

          let emittedCount = 0;
          for await (const partial of result.partialOutputStream) {
            if (!partial?.slides) continue;
            // Slides at index 0..length-2 are complete (model moved past them)
            const completeCount = Math.max(0, partial.slides.length - 1);
            for (let i = emittedCount; i < completeCount; i++) {
              const s = partial.slides[i];
              if (isCompleteSlide(s)) {
                slideQueue.push(s);
                notify();
              }
            }
            emittedCount = completeCount;
          }

          // Final output — push any remaining slides
          const finalOutput = await result.output;
          if (finalOutput?.slides) {
            for (let i = emittedCount; i < finalOutput.slides.length; i++) {
              const s = finalOutput.slides[i];
              if (isCompleteSlide(s)) {
                slideQueue.push(s);
                notify();
              }
            }
          }

          generateSpan.setAttribute(
            "deck.slide_count",
            finalOutput?.slides?.length ?? 0
          );
        } catch (err) {
          generateSpan.recordException(err as Error);
          generateSpan.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          generateSpan.end();
          producerDone = true;
          notify();
        }
      })(),

      // CONSUMER: Gemini Flash Lite grounding, serial
      (async () => {
        while (true) {
          const slide = await waitForSlide();
          if (slide === null) break;

          const grounded = await groundSlide(slide, chunks, {
            evaluateSlide,
            regenerateSlide,
          });

          if (grounded.grounding_status !== "grounded") {
            slidesFailedGrounding++;
          }
          groundedSlides.push(grounded);
          emit({ type: "slide", slide: grounded });
        }
      })(),
    ]);

    // Persist
    emit({ type: "stage", stage: "saving", message: "Saving results..." });

    const dealId = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalSlides = groundedSlides.length;
    const faithfulnessRate =
      totalSlides > 0
        ? (totalSlides - slidesFailedGrounding) / totalSlides
        : 1;

    const deck = {
      deal_id: dealId,
      company: signals.company,
      slides: groundedSlides,
    };

    const pipelineRun = {
      deal_id: dealId,
      user_id: userId,
      signals,
      generated_deck: deck,
      retrieved_chunk_ids: chunks.map((c) => String(c.id)),
      retrieval_scores: chunks.map((c) => ({ id: c.id, score: c.score })),
      total_slides: totalSlides,
      slides_failed_grounding: slidesFailedGrounding,
      faithfulness_rate: faithfulnessRate,
      hallucination_check_iterations: 0,
      latency_ms: Date.now() - startTime,
    };

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
      console.error("Failed to save pipeline run");
    }

    emit({ type: "complete", deal_id: dealId, faithfulness_rate: faithfulnessRate });
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
