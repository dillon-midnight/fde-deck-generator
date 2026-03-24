// Workflow orchestrator for deck generation.
//
// This function runs in a sandboxed workflow environment with deterministic
// replay. It can only call step functions (marked with 'use step') — it
// cannot use Node.js modules directly. All actual work happens in the step
// functions defined in generate-deck-workflow.ts.
//
// If the process crashes, the workflow resumes from the last completed step.
// Completed steps are replayed from the event log (cached return values),
// so only the in-flight step is re-executed.

import {
  retrieveContext,
  generateAllSlides,
  groundAndPersistSlide,
  finalizePipelineRun,
} from "./generate-deck-workflow";

export async function deckGenerationWorkflow(
  runId: string,
  rawSignals: unknown,
  startTime: number
) {
  "use workflow";

  // Step 1: Retrieve context (validate, embed, vector search, few-shot)
  const { signals, chunks, fewShotExamples } = await retrieveContext(
    rawSignals,
    runId
  );

  // Step 2: Generate all slides (consumes stream to completion)
  const slides = await generateAllSlides(
    signals,
    chunks,
    fewShotExamples,
    runId
  );

  // Steps 3..N: Ground each slide individually. Each step persists the
  // grounded slide to workflow_runs.slides so the client sees progress.
  const groundedSlides = [];
  for (let i = 0; i < slides.length; i++) {
    const grounded = await groundAndPersistSlide(
      slides[i],
      chunks,
      runId,
      i,
      slides.length
    );
    groundedSlides.push(grounded);
  }

  // Final step: Persist to pipeline_runs, mark workflow complete
  const result = await finalizePipelineRun(
    runId,
    signals,
    groundedSlides,
    chunks,
    startTime
  );

  return result;
}
