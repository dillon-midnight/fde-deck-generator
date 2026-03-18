# Solutions Architect Deck Generator

Most enterprise software companies run their technical sales motion with too few solutions architects (SAs) relative to the size of their pipeline.

The result is a predictable bottleneck: deals lose momentum, sales cycles lengthen, and revenue growth slows down.

This SA Deck Generator creates technical solution decks tailored to each enterprise prospect's unique situation, in under two minutes, while grounding every talking point in verified product documentation.

It's an AI app that automatically produces a deck as defensible as one a senior SA would build manually.

## Defining Success

Success with the SA Deck Generator looks different depending on where you sit.

A CFO sees success in pipeline coverage ratios. The SA Deck Generator should allow a technical sales motion to support more deals per quarter, with more complexity, without a proportionate increase in cost.

A VP of Engineering sees success in the faithfulness rate: a score on every generated deck that tracks whether the system is producing defensible output or hallucinating. The SA Deck Generator should maintain or even improve the faithfulness rate as the solution or platform becomes more complex. It also learns from previous usage so it can improve its performance over time.

An SA sees success in time reclaimed. An SA might be spending hours to get up to speed on a new prospect and build a deck from scratch. After using the SA Deck Generator, the SA can spend 30 minutes editing a deck that's already grounded in real product documentation and the prospect's own situation.

An AE sees success in deal velocity. Instead of waiting days for an SA to free up and build a technical solution deck, the AE can have a personalized, technically credible deck within the same day as the discovery call, keeping deal momentum alive when it's most critical.

The common denominator of success for all stakeholders is more technical deals moving faster, with fewer errors, at lower cost per deal.

## Architecture

How it works:

- The app works the way a good SA would: start with what you know about the prospect, find the most relevant product knowledge, then build the solution deck.
- The input for the app is a form to intake info about the prospect during the discovery call, such as pain points, use cases, objections, and tool stack. This ensures the output deck is tailored to the prospect's unique situation, while taking less than two minutes to generate.
- The app uses RAG architecture, so it can generate slides grounded in real documentation on the product or platform without having to retrain the AI system, even as the product or platform's complexity grows over time.

The app has noteworthy approaches to the following:

### Evaluation

- It reuses our RAG to check every slide against the source documentation before the SA sees it, rewriting any claim it can't verify.
- Every edit an SA makes gets logged and fed back into future decks as an example of what good looks like. This means the app gets more accurate with every use without anyone having to maintain it.
- Every time the app generates a deck, it logs the `faithfulness_rate`, so it can track quality metrics over time.
- It has fixture-based regression tests with pre-approved examples of desirable outputs, so we can ensure that future updates to the AI business logic don't degrade output quality.

### Model selection and trade-offs

- First is slide generation, where quality is the priority, so the selected model is Claude Sonnet.
- Second is grounding evaluation and re-generation, where cost is the priority, so the selected model is Gemini Flash Lite.

### Prompting and context selection

- With our RAG approach, the app prompts the model with the correct URLs to cite by injecting the most relevant chunks of the product documentation and their source URL attributions.
- The prompt also injects few-shot examples of the most recent prior SA corrections and their context, so the model learns from SA preferences.

### Fallbacks

The app keeps it simple for now and just uses AI Gateway's native model fallback feature.

### Safety

The app also keeps it simple for now and uses AI Gateway's Zero Data Retention feature, while also implementing basics like prompt injection detection, input validation, auth on every route, and system prompt hardening.

## Production Considerations

### Security

- Auth on every route (`requireAuth()` in all API handlers)
- Input validation via Zod schemas (`SignalsSchema.strict()`)
- Prompt injection detection (`src/lib/injection.ts`) with normalization for leet-speak variants
- Zero Data Retention via AI Gateway (`zeroDataRetention: true` on all model calls)
- System prompt hardening (explicit rules against following instructions from `<signals>` and `<product_knowledge>` tags)
- Security headers in `next.config.ts` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- JWT-based sessions with Google OAuth refresh token rotation and error handling (`RefreshAccessTokenError`)
- CRON endpoint gated behind `CRON_SECRET` bearer token

### Reliability

- AI Gateway model fallbacks (`models: [...]` in `providerOptions`) for both generation and grounding paths
- Upsert logic in the crawl cron (`WHERE NOT EXISTS`) to prevent duplicate chunk insertion
- Abort controller on streaming sessions to cancel in-flight requests on unmount
- Graceful partial stream handling — slides are emitted as they complete, not waiting for full output
- Timeout on fetch requests during crawl (`AbortSignal.timeout(10000)`)
- Producer/consumer pattern with slide queue so grounding runs concurrently with generation

### Failure modes

- Error events emitted on the stream so the client handles failures gracefully
- Empty chunk retrieval check — fails fast with a clear error before wasting generation tokens
- `try/catch` on every API route with appropriate HTTP status codes
- Abort error distinguished from real errors in stream context (`DOMException` check)
- Eval route handles missing deal gracefully (404)
- Google Slides export surfaces token expiry to the user with actionable message

### Observability

- OpenTelemetry tracing via `@vercel/otel` (`src/instrumentation.ts`)
- Named spans on both LLM calls: `llm-generate-deck-stream` and `llm-regen-slide`
- Span attributes: model name, company, slide number, grounding attempt number
- `faithfulness_rate` logged per pipeline run in the database
- `latency_ms` tracked end-to-end per run
- `slides_failed_grounding` and `hallucination_check_iterations` stored per run
- Vercel Cron for automated weekly re-crawl (`vercel.json`)

## Vercel Platform Usage

### AI SDK and AI Gateway

The app uses AI SDK 6 throughout, with AI Gateway as the model routing layer for every inference call. Generation uses `streamText` with `Output.object` to stream structured JSON directly. Slides materialize in the frontend as they complete, rather than waiting for the full deck. Grounding and regeneration use `generateText` with `Output.object` for structured evaluation results. Both call paths go through AI Gateway, which means a single authentication layer for all providers rather than managing separate API keys for Anthropic and Google.

AI Gateway's `providerOptions` model fallback chains are configured for both paths independently: Claude Sonnet falls back to Gemini 2.5 Pro then Mistral Large for generation; Gemini Flash Lite falls back to Claude Haiku then Groq Llama for grounding. This means a provider outage on either path degrades gracefully without taking down the pipeline. Zero Data Retention (`zeroDataRetention: true`) is set on every model call.

AI Gateway's built-in prompt caching is not implemented yet. Deck generation is low-repetition, and every prospect and chunk set is different, so cache hit rates would be negligible.

### Fluid Compute

The streaming generation route is a natural fit for Fluid Compute. The function spends most of its wall-clock time waiting on I/O (embedding calls, vector search, LLM streaming, grounding eval) not executing code. Fluid Compute bills only during execution, so the cost per deck scales with actual work, not wait time.

### Vercel Cron

A weekly re-crawl job in `vercel.json` keeps the RAG knowledge base current as the product documentation changes. The cron endpoint is gated behind a `CRON_SECRET` bearer token so it can't be triggered externally.

### OpenTelemetry via @vercel/otel

`src/instrumentation.ts` registers the OTel provider at startup. Custom named spans instrument both LLM calls: `llm-generate-deck-stream` for the generation step and `llm-regen-slide` for each grounding regeneration attempt. Span attributes include model name, company, slide number, and grounding attempt number, which means slow or failing slides are traceable in the Vercel Observability dashboard rather than buried in logs.

### Next.js App Router

The app uses the App Router throughout: server components for data fetching, route handlers for all API endpoints, and `src/instrumentation.ts` for the OTel registration hook, which requires the App Router's `register()` lifecycle. The streaming route uses `ReadableStream` with SSE headers, which Vercel's edge network handles without any additional configuration.

### Deployment Pipeline

Vercel Checks gates every production deployment on the CI test suite. The GitHub Actions check job (lint, typecheck, vitest) must pass before Vercel promotes a build to production. Every PR also gets a Vercel Preview Deployment.

### NextAuth.js

Google OAuth with offline access and forced consent prompt ensures a refresh token is always issued. The JWT callback rotates access tokens automatically, with `RefreshAccessTokenError` surfaced to the client on failure, so a stale session surfaces as a re-authentication prompt rather than a silent API failure. The Google OAuth token doubles as the credential for Google Slides export, so users authenticate once and get both app access and export capability.
