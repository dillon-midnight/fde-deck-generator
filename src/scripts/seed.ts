import { resolve } from "path";
import { neon } from "@neondatabase/serverless";
import { chunkDocument, DocChunk } from "../lib/chunker";
import { embedBatch } from "../lib/embeddings";

import { config } from "dotenv";
config({ path: resolve(__dirname, "../../.env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.local");
}

const sql = neon(DATABASE_URL);

const SEED_ORIGIN = "https://docs.credal.ai";
const MAX_PAGES = 200;
const EMBED_BATCH_SIZE = 100;

async function runSchema() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE TABLE IF NOT EXISTS doc_chunks (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(1536),
    source_url TEXT NOT NULL,
    page_title TEXT NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS doc_chunks_embedding_idx ON doc_chunks USING hnsw (embedding vector_cosine_ops)`;
  await sql`CREATE TABLE IF NOT EXISTS eval_tuples (
    eval_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    deal_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    transcript_signals JSONB NOT NULL,
    retrieved_chunk_ids TEXT[] NOT NULL,
    generated_deck JSONB NOT NULL,
    ae_diff JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pipeline_runs (
    id SERIAL PRIMARY KEY,
    deal_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    signals JSONB NOT NULL,
    generated_deck JSONB,
    retrieved_chunk_ids TEXT[],
    retrieval_scores JSONB,
    total_slides INT,
    slides_failed_grounding INT DEFAULT 0,
    faithfulness_rate REAL,
    hallucination_check_iterations INT,
    latency_ms INT
  )`;
  console.log("Schema created successfully.");
}

async function crawl(): Promise<Map<string, string>> {
  const visited = new Set<string>();
  const queue: string[] = [SEED_ORIGIN];
  const pages = new Map<string, string>();

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!;

    const normalized = url.split("#")[0].replace(/\/$/, "");
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    console.log(`[${visited.size}/${MAX_PAGES}] Crawling: ${normalized}`);

    try {
      const response = await fetch(normalized, {
        headers: { "User-Agent": "CredalDeckGenBot/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`  Skipping ${normalized} — HTTP ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await response.text();
      pages.set(normalized, html);

      const linkRegex = /href=["']([^"']+)["']/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        try {
          const resolved = new URL(match[1], normalized).href.split("#")[0].replace(/\/$/, "");
          if (resolved.startsWith(SEED_ORIGIN) && !visited.has(resolved)) {
            queue.push(resolved);
          }
        } catch {
          // invalid URL, skip
        }
      }
    } catch (err) {
      console.warn(`  Error fetching ${normalized}:`, (err as Error).message);
    }
  }

  console.log(`Crawl complete. Found ${pages.size} pages.`);
  return pages;
}

async function seedChunks(pages: Map<string, string>) {
  const allChunks: DocChunk[] = [];

  for (const [url, html] of pages) {
    const chunks = chunkDocument(html, url);
    allChunks.push(...chunks);
  }

  console.log(`Total chunks: ${allChunks.length}`);

  for (let i = 0; i < allChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    console.log(`Embedding batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / EMBED_BATCH_SIZE)}...`);
    const embeddings = await embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const embedding = embeddings[j];
      const embeddingStr = `[${embedding.join(",")}]`;

      await sql`INSERT INTO doc_chunks (content, embedding, source_url, page_title) VALUES (${chunk.content}, ${embeddingStr}::vector, ${chunk.source_url}, ${chunk.page_title})`;
    }

    console.log(`  Inserted ${Math.min(i + EMBED_BATCH_SIZE, allChunks.length)}/${allChunks.length} chunks.`);
  }

  console.log("Seeding complete.");
}

async function main() {
  console.log("Running schema...");
  await runSchema();

  console.log("Starting crawl...");
  const pages = await crawl();

  console.log("Seeding chunks...");
  await seedChunks(pages);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
