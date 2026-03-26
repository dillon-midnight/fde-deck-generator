// Durable workflow implementation for deck generation.
//
// This module extracts the pipeline logic from generate-deck-stream.ts into
// discrete step functions suitable for Vercel Workflow's 'use step' directive.
// Each step is a retry boundary and persistence checkpoint — if the process
// crashes or the serverless function times out, the workflow resumes from the
// last completed step rather than restarting from scratch.
//
// DUAL-WRITE PATTERN: Each step writes to both the DB (for persistence and
// dashboard queries) and the workflow's native streams via getWritable() (for
// real-time transport to the client). The "slides" namespace carries grounded
// slides; the "status" namespace carries stage transitions. The client consumes
// these via getRun().getReadable() in the stream endpoint. releaseLock() must
// be called after each write() since the SDK enforces single-writer semantics.
//
// CONCURRENCY WITHIN A SINGLE STEP: Generation and grounding run concurrently
// inside one 'use step' via a producer/consumer Promise.all — the same pattern
// used in the SSE path (generate-deck-stream.ts). Grounding starts on slide 1
// while the model is still generating slide 2, so the first grounded slide
// appears in ~5-8s instead of waiting ~25s for all slides to generate first.
// Each grounded slide is written to both the DB and the workflow stream as it
// completes.
//
// TRADEOFF: We lose per-slide retry boundaries. If the step crashes during
// slide 5's grounding, slides 1-4 must be re-generated and re-grounded on
// retry. This is acceptable because each grounding call is fast (~2-3s) and
// total step time is well within serverless limits.
//
// DETERMINISTIC REPLAY: If the workflow resumes after a crash, completed steps
// are replayed from the event log (their return values are replayed, not
// re-executed). Only the step that was in-flight at crash time is retried.

import { streamText, generateText, Output } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import {
  SignalsSchema,
  SlideSchema,
  type Signals,
  type Slide,
} from "./schemas";
import {
  GENERATION_MODEL,
  GENERATION_PROVIDER_OPTIONS,
  GROUNDING_MODEL,
  GROUNDING_PROVIDER_OPTIONS,
} from "./models";
import { injectionDetected } from "./injection";
import { embedText } from "./embeddings";
import { vectorSearch } from "./rag";
import { groundSlide, type GroundingChunk } from "./grounding";
import { type ChunkResult } from "./rag";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { sql } from "./db";
import { getWritable } from "workflow";

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

// Step 1: Validate signals, check for injection, embed query, vector search,
// fetch few-shot examples. Returns everything the generation step needs.
export async function retrieveContext(
  rawSignals: unknown,
  runId: string
) {
  "use step";

  const statusWritable = getWritable<{ status: string; message: string }>({ namespace: "status" });

  await sql`
    UPDATE workflow_runs
    SET status = 'retrieval', status_message = 'Retrieving product knowledge...', updated_at = NOW()
    WHERE run_id = ${runId}
  `;
  const sw = statusWritable.getWriter();
  await sw.write({ status: "retrieval", message: "Retrieving product knowledge..." });
  sw.releaseLock();

  const signals = SignalsSchema.parse(rawSignals);
  if (injectionDetected(signals)) {
    throw new Error("Injection detected in signals input");
  }

  const queryText = `${signals.company} ${signals.industry} ${signals.pain_points.join(" ")} ${signals.use_cases.join(" ")}`;
  const queryEmbedding = await embedText(queryText);
  const chunks = await vectorSearch(queryEmbedding, "doc_chunks", 10);

  if (chunks.length === 0) {
    throw new Error("No chunks retrieved — cannot generate grounded deck");
  }

  let fewShotExamples: { signals: Signals; deck: { deal_id: string; company: string; slides: Slide[] }; diff?: unknown }[] = [];
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
    // No eval tuples yet — degrade gracefully to zero-shot
  }

  return { signals, chunks, fewShotExamples };
}

// Step 2: Generate all slides and ground them concurrently using a
// producer/consumer pattern. The producer streams slides from Claude Sonnet
// and pushes them to a queue; the consumer grounds each slide with Gemini
// Flash and appends it to the DB. First grounded slide appears in ~5-8s.
export async function generateAndGroundSlides(
  signals: Signals,
  chunks: GroundingChunk[],
  fewShotExamples: { signals: Signals; deck: { deal_id: string; company: string; slides: Slide[] }; diff?: unknown }[],
  runId: string
) {
  "use step";

  const slidesWritable = getWritable<Slide>({ namespace: "slides" });
  const statusWritable = getWritable<{ status: string; message: string }>({ namespace: "status" });

  await sql`
    UPDATE workflow_runs
    SET status = 'generation', status_message = 'Generating slides...', updated_at = NOW()
    WHERE run_id = ${runId}
  `;
  {
    const sw = statusWritable.getWriter();
    await sw.write({ status: "generation", message: "Generating slides..." });
    sw.releaseLock();
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(signals, chunks, fewShotExamples);

  // Producer/consumer queue mechanism
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

  // Grounding callbacks
  const evaluateSlide = async (s: Slide) => {
    const { output } = await generateText({
      model: gateway(GROUNDING_MODEL),
      providerOptions: GROUNDING_PROVIDER_OPTIONS,
      output: Output.object({
        schema: z.object({
          slide_number: z.number(),
          grounded: z.boolean(),
          reason: z.string(),
        }),
      }),
      system:
        "You are a faithfulness evaluator. Evaluate whether the slide's talking_points and features are supported by the source chunk content. A slide is grounded if its claims are substantiated by the chunk text, not just if it references a valid URL.",
      prompt: `Evaluate this slide for faithfulness against the source chunks.\n\nSlide:\n${JSON.stringify(s, null, 2)}\n\nSource chunks:\n${chunks.map((c) => `[source:${c.source_url}]\n${c.content}`).join("\n\n")}\n\nReturn whether it is grounded and a brief reason.`,
      maxOutputTokens: 512,
    });
    return output!;
  };

  const regenerateSlide = async (s: Slide) => {
    const { output } = await generateText({
      model: gateway(GROUNDING_MODEL),
      providerOptions: GROUNDING_PROVIDER_OPTIONS,
      output: Output.object({ schema: SlideSchema }),
      system: systemPrompt,
      prompt: `Regenerate this slide to be grounded in the product knowledge. The sources MUST reference URLs from the provided chunks.\n\nSlide to fix:\n${JSON.stringify(s)}\n\nAvailable chunks:\n${chunks.map((c) => `[source:${c.source_url}]\n${c.content}`).join("\n\n")}\n\nReturn a single JSON slide object.`,
      maxOutputTokens: 1024,
    });
    return output!;
  };

  const groundedSlides: Slide[] = [];
  let totalSlides = 0;

  await Promise.all([
    // PRODUCER: Claude Sonnet via streamText
    (async () => {
      try {
        const result = streamText({
          model: gateway(GENERATION_MODEL),
          providerOptions: GENERATION_PROVIDER_OPTIONS,
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
          totalSlides = finalOutput.slides.length;
        }
      } finally {
        producerDone = true;
        notify();
      }
    })(),

    // CONSUMER: Gemini Flash grounding, serial
    (async () => {
      let slideIndex = 0;
      while (true) {
        const slide = await waitForSlide();
        if (slide === null) break;

        // Update status to grounding on first slide
        const groundingMsg = `Grounding slide ${slideIndex + 1}...`;
        if (slideIndex === 0) {
          await sql`
            UPDATE workflow_runs
            SET status = 'grounding',
                status_message = 'Grounding slide 1...',
                updated_at = NOW()
            WHERE run_id = ${runId}
          `;
        } else {
          await sql`
            UPDATE workflow_runs
            SET status_message = ${groundingMsg},
                updated_at = NOW()
            WHERE run_id = ${runId}
          `;
        }
        {
          const sw = statusWritable.getWriter();
          await sw.write({ status: "grounding", message: groundingMsg });
          sw.releaseLock();
        }

        const grounded = await groundSlide(slide, chunks, {
          evaluateSlide,
          regenerateSlide,
        });

        groundedSlides.push(grounded);

        // Append grounded slide to DB
        await sql`
          UPDATE workflow_runs
          SET slides = slides || ${JSON.stringify([grounded])}::jsonb,
              updated_at = NOW()
          WHERE run_id = ${runId}
        `;

        // Write grounded slide to workflow stream
        {
          const sw = slidesWritable.getWriter();
          await sw.write(grounded);
          sw.releaseLock();
        }

        slideIndex++;
      }
    })(),
  ]);

  // Close the slides stream — status stream stays open for finalizePipelineRun
  {
    const sw = slidesWritable.getWriter();
    await sw.close();
    sw.releaseLock();
  }

  return groundedSlides;
}

// Final step: Create the pipeline_runs row (same schema as SSE path) and
// mark the workflow run as complete with the permanent deal_id.
export async function finalizePipelineRun(
  runId: string,
  signals: Signals,
  groundedSlides: Slide[],
  chunks: ChunkResult[],
  startTime: number
) {
  "use step";

  const statusWritable = getWritable<{ status: string; message: string; deal_id?: string; faithfulness_rate?: number }>({ namespace: "status" });

  await sql`
    UPDATE workflow_runs
    SET status = 'saving', status_message = 'Saving results...', updated_at = NOW()
    WHERE run_id = ${runId}
  `;
  {
    const sw = statusWritable.getWriter();
    await sw.write({ status: "saving", message: "Saving results..." });
    sw.releaseLock();
  }

  const dealId = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const totalSlides = groundedSlides.length;
  let slidesFailedGrounding = 0;
  for (const s of groundedSlides) {
    if (s.grounding_status !== "grounded") slidesFailedGrounding++;
  }
  const faithfulnessRate =
    totalSlides > 0
      ? (totalSlides - slidesFailedGrounding) / totalSlides
      : 1;

  const deck = {
    deal_id: dealId,
    company: signals.company,
    slides: groundedSlides,
  };

  await sql`
    INSERT INTO pipeline_runs (
      deal_id, user_id, signals, generated_deck, retrieved_chunk_ids,
      retrieval_scores, total_slides, slides_failed_grounding,
      faithfulness_rate, hallucination_check_iterations, latency_ms
    ) VALUES (
      ${dealId}, (SELECT user_id FROM workflow_runs WHERE run_id = ${runId}),
      ${JSON.stringify(signals)}, ${JSON.stringify(deck)},
      ${chunks.map((c) => String(c.id))}, ${JSON.stringify(chunks.map((c) => ({ id: c.id, score: c.score })))},
      ${totalSlides}, ${slidesFailedGrounding},
      ${faithfulnessRate}, ${0},
      ${Date.now() - startTime}
    )
  `;

  await sql`
    UPDATE workflow_runs
    SET status = 'complete',
        status_message = 'Done',
        deal_id = ${dealId},
        updated_at = NOW()
    WHERE run_id = ${runId}
  `;

  // Write terminal status and close the stream
  {
    const sw = statusWritable.getWriter();
    await sw.write({ status: "complete", message: "Done", deal_id: dealId, faithfulness_rate: faithfulnessRate });
    await sw.close();
    sw.releaseLock();
  }

  return { dealId, faithfulnessRate };
}
