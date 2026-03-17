import type { Deck, Slide } from "./schemas";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("fde-deck-generator");

interface GroundingChunk {
  id: number;
  content: string;
  source_url: string;
}

interface GroundingOptions {
  generateSlide: (slide: Slide, chunks: GroundingChunk[]) => Promise<Slide>;
  maxAttempts?: number;
}

interface GroundingResult {
  deck: Deck;
  iterations: number;
  slidesFailedGrounding: number;
}

function isSlideGrounded(slide: Slide, chunkUrls: Set<string>): boolean {
  return slide.sources.length > 0 && slide.sources.some((s) => chunkUrls.has(s));
}

export async function checkAndRegenerate(
  deck: Deck,
  chunks: GroundingChunk[],
  options: GroundingOptions
): Promise<GroundingResult> {
  const { generateSlide, maxAttempts = 2 } = options;
  const chunkUrls = new Set(chunks.map((c) => c.source_url));

  let currentSlides = [...deck.slides];
  let iterations = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const failingIndices: number[] = [];
    for (let i = 0; i < currentSlides.length; i++) {
      if (!isSlideGrounded(currentSlides[i], chunkUrls)) {
        failingIndices.push(i);
      }
    }

    if (failingIndices.length === 0) break;

    iterations++;
    for (const idx of failingIndices) {
      const regenerated = await tracer.startActiveSpan("llm-regen-slide", async (span) => {
        span.setAttributes({
          "slide.number": currentSlides[idx].slide_number,
          "grounding.attempt": attempt + 1,
        });
        try {
          const result = await generateSlide(currentSlides[idx], chunks);
          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      });
      currentSlides[idx] = regenerated;
    }
  }

  // Final grounding check and status assignment
  let slidesFailedGrounding = 0;
  const finalSlides = currentSlides.map((slide) => {
    const grounded = isSlideGrounded(slide, chunkUrls);
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
