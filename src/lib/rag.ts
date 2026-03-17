import { sql } from "./db";

export interface ChunkResult {
  id: number;
  content: string;
  source_url: string;
  score: number;
}

export async function vectorSearch(
  queryEmbedding: number[],
  table: string,
  topK: number
): Promise<ChunkResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  if (table === "doc_chunks") {
    const rows = await sql`
      SELECT id, content, source_url,
        1 - (embedding <=> ${embeddingStr}::vector) as score
      FROM doc_chunks
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${topK}
    `;
    return rows as unknown as ChunkResult[];
  }

  if (table === "eval_tuples") {
    const rows = await sql`
      SELECT eval_id as id, transcript_signals as content, generated_deck, ae_diff
      FROM eval_tuples
      ORDER BY timestamp DESC
      LIMIT ${topK}
    `;
    return rows as unknown as ChunkResult[];
  }

  return [];
}
