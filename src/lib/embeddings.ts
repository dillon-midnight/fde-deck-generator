import { embed, embedMany } from "ai";
import { gateway } from "@ai-sdk/gateway";

const embeddingModel = gateway.textEmbeddingModel("openai/text-embedding-3-small");

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: embeddingModel, values: texts });
  return embeddings;
}
