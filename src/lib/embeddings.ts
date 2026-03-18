import { embed, embedMany } from "ai";
import { gateway } from "@ai-sdk/gateway";

// text-embedding-3-small (1536 dimensions) over text-embedding-3-large
// (3072 dimensions) for two reasons:
// 1. Cost: small is ~5x cheaper per token. At 200 pages × ~10 chunks/page
//    = 2000 embeddings per crawl, the difference compounds quickly.
// 2. Storage and search latency: 1536-dimensional vectors are half the size
//    in pgvector's HNSW index, which meaningfully reduces cosine search time
//    at query time. Retrieval quality on product documentation (structured,
//    low-ambiguity text) does not degrade materially at the smaller dimension.
//    We measured no meaningful difference in chunk relevance on test queries.
const embeddingModel = gateway.textEmbeddingModel("openai/text-embedding-3-small");

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
  return embeddings;
}
