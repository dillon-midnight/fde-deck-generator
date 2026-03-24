import type { Deck, Slide } from "./schemas";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("fde-deck-generator");

export interface GroundingChunk {
  id: number;
  content: string;
  source_url: string;
}

export interface SlideEvaluation {
  slide_number: number;
  grounded: boolean;
  reason: string;
}

interface GroundingOptions {
  generateSlide: (slide: Slide, chunks: GroundingChunk[]) => Promise<Slide>;
  evaluateSlides: (slides: Slide[], chunks: GroundingChunk[]) => Promise<SlideEvaluation[]>;
  maxAttempts?: number;
}

interface GroundingResult {
  deck: Deck;
  iterations: number;
  slidesFailedGrounding: number;
}

// URL pre-filter: check whether a slide's sources contain at least one URL
// that came from the retrieved chunks before spending a Gemini token on it.
//
// If the model hallucinated a source URL that doesn't exist in our chunk set,
// we know the slide is ungrounded without an LLM call. On a 10-slide deck this
// can eliminate 2-3 grounding calls per run. At scale this is meaningful cost
// reduction. The LLM faithfulness check runs only on slides that pass this
// cheaper structural gate.
function hasMatchingUrl(slide: Slide, chunkUrls: Set<string>): boolean {
  return slide.sources.length > 0 && slide.sources.some((s) => chunkUrls.has(s));
}

export async function checkAndRegenerate(
  deck: Deck,
  chunks: GroundingChunk[],
  options: GroundingOptions
): Promise<GroundingResult> {
  // maxAttempts = 2 is a deliberate cost ceiling. Regenerating indefinitely
  // until grounded would guarantee faithfulness but create unbounded LLM spend
  // on pathological cases where the retrieval chunks don't support the prospect's
  // use case. Two attempts catches the common failure (bad source URL on first
  // generation) without letting a single slide consume the budget of the whole
  // deck.
  const { generateSlide, evaluateSlides, maxAttempts = 2 } = options;
  const chunkUrls = new Set(chunks.map((c) => c.source_url));

  const currentSlides = [...deck.slides];
  let iterations = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Fast pre-filter: slides without any matching URL are automatically ungrounded
    const urlFailIndices = new Set<number>();
    const candidateSlides: Slide[] = [];
    const candidateIndices: number[] = [];

    for (let i = 0; i < currentSlides.length; i++) {
      if (!hasMatchingUrl(currentSlides[i], chunkUrls)) {
        urlFailIndices.add(i);
      } else {
        candidateSlides.push(currentSlides[i]);
        candidateIndices.push(i);
      }
    }

    // LLM faithfulness evaluation on slides that pass the URL check
    const llmFailIndices = new Set<number>();
    if (candidateSlides.length > 0) {
      const evaluations = await evaluateSlides(candidateSlides, chunks);
      for (const ev of evaluations) {
        if (!ev.grounded) {
          const idx = candidateIndices.find(
            (i) => currentSlides[i].slide_number === ev.slide_number
          );
          if (idx !== undefined) llmFailIndices.add(idx);
        }
      }
    }

    const failingIndices = [
      ...Array.from(urlFailIndices),
      ...Array.from(llmFailIndices),
    ].sort((a, b) => a - b);

    if (failingIndices.length === 0) break;

    iterations++;
    for (const idx of failingIndices) {
      const regenSpan = tracer.startSpan("llm-regen-slide");
      regenSpan.setAttributes({
        "slide.number": currentSlides[idx].slide_number,
        "grounding.attempt": attempt + 1,
      });
      try {
        currentSlides[idx] = await generateSlide(currentSlides[idx], chunks);
      } catch (err) {
        regenSpan.recordException(err as Error);
        regenSpan.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        regenSpan.end();
      }
    }
  }

  // Separate pass for final status assignment. The retry loop above may have
  // improved slides, so we re-evaluate from scratch to assign definitive
  // grounded/needs_review status. The duplicated URL pre-filter + LLM check
  // is intentional: the first pass asks "should we regenerate?", this one
  // asks "what's the final status?"
  let slidesFailedGrounding = 0;
  const groundedSet = new Set<number>();

  // URL pre-filter
  const finalCandidates: Slide[] = [];
  const finalCandidateIndices: number[] = [];
  for (let i = 0; i < currentSlides.length; i++) {
    if (hasMatchingUrl(currentSlides[i], chunkUrls)) {
      finalCandidates.push(currentSlides[i]);
      finalCandidateIndices.push(i);
    }
  }

  if (finalCandidates.length > 0) {
    const evaluations = await evaluateSlides(finalCandidates, chunks);
    for (const ev of evaluations) {
      if (ev.grounded) {
        const idx = finalCandidateIndices.find(
          (i) => currentSlides[i].slide_number === ev.slide_number
        );
        if (idx !== undefined) groundedSet.add(idx);
      }
    }
  }

  const finalSlides = currentSlides.map((slide, i) => {
    const grounded = groundedSet.has(i);
    if (!grounded) slidesFailedGrounding++;
    return {
      ...slide,
      grounding_status: grounded ? ("grounded" as const) : ("needs_review" as const),
    };
  });

  return {
    deck: { ...deck, slides: finalSlides },
    iterations,
    slidesFailedGrounding,
  };
}

// groundSlide is the per-slide grounding function used by the streaming/workflow
// pipelines. It operates on one slide at a time so results can be emitted
// to the client as they complete, enabling the progressive rendering UX.
//
// checkAndRegenerate (above) is the batch alternative — it takes a full deck,
// evaluates all slides, and re-generates failing ones in a loop. It's used by
// the grounding tests and is available for batch re-grounding jobs where
// per-slide streaming isn't needed.
export async function groundSlide(
  slide: Slide,
  chunks: GroundingChunk[],
  options: {
    evaluateSlide: (slide: Slide, chunks: GroundingChunk[]) => Promise<SlideEvaluation>;
    regenerateSlide: (slide: Slide, chunks: GroundingChunk[]) => Promise<Slide>;
    maxAttempts?: number;
  }
): Promise<Slide & { grounding_status: "grounded" | "needs_review" }> {
  const { evaluateSlide, regenerateSlide, maxAttempts = 2 } = options;
  const chunkUrls = new Set(chunks.map((c) => c.source_url));

  let current = slide;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!hasMatchingUrl(current, chunkUrls)) {
      current = await regenerateSlide(current, chunks);
      continue;
    }

    const evaluation = await evaluateSlide(current, chunks);
    if (evaluation.grounded) {
      return { ...current, grounding_status: "grounded" };
    }

    current = await regenerateSlide(current, chunks);
  }

  return { ...current, grounding_status: "needs_review" };
}
