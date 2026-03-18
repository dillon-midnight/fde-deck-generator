import type { Deck, Slide } from "./schemas";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("fde-deck-generator");

interface GroundingChunk {
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

function hasMatchingUrl(slide: Slide, chunkUrls: Set<string>): boolean {
  return slide.sources.length > 0 && slide.sources.some((s) => chunkUrls.has(s));
}

export async function checkAndRegenerate(
  deck: Deck,
  chunks: GroundingChunk[],
  options: GroundingOptions
): Promise<GroundingResult> {
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

  // Final evaluation for status assignment
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
