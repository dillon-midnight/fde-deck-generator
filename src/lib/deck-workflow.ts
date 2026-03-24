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
  generateAndGroundSlides,
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

  // Step 2: Generate and ground slides concurrently (producer/consumer)
  const groundedSlides = await generateAndGroundSlides(
    signals,
    chunks,
    fewShotExamples,
    runId
  );

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
