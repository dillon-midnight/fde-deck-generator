import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { chunkDocument } from "@/lib/chunker";
import { embedBatch } from "@/lib/embeddings";

const SEED_ORIGIN = "https://docs.credal.ai";
const MAX_PAGES = 200;
const EMBED_BATCH_SIZE = 100;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Crawl
    const visited = new Set<string>();
    const queue: string[] = [SEED_ORIGIN];
    const pages = new Map<string, string>();

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const url = queue.shift()!;
      const normalized = url.split("#")[0].replace(/\/$/, "");
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        const response = await fetch(normalized, {
          headers: { "User-Agent": "CredalDeckGenBot/1.0" },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) continue;

        const html = await response.text();
        pages.set(normalized, html);

        const linkRegex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          try {
            const resolved = new URL(match[1], normalized).href
              .split("#")[0]
              .replace(/\/$/, "");
            if (
              resolved.startsWith(SEED_ORIGIN) &&
              !visited.has(resolved)
            ) {
              queue.push(resolved);
            }
          } catch {
            // invalid URL
          }
        }
      } catch {
        // fetch error
      }
    }

    // Chunk and upsert
    let totalChunks = 0;
    for (const [url, html] of pages) {
      const chunks = chunkDocument(html, url);

      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const texts = batch.map((c) => c.content);
        const embeddings = await embedBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          const embeddingStr = `[${embedding.join(",")}]`;

          // Upsert: skip if exact content already exists for this URL
          await sql`
            INSERT INTO doc_chunks (content, embedding, source_url, page_title)
            SELECT ${chunk.content}, ${embeddingStr}::vector, ${chunk.source_url}, ${chunk.page_title}
            WHERE NOT EXISTS (
              SELECT 1 FROM doc_chunks
              WHERE source_url = ${chunk.source_url} AND content = ${chunk.content}
            )
          `;
          totalChunks++;
        }
      }
    }

    return NextResponse.json({
      pages: pages.size,
      chunks: totalChunks,
    });
  } catch (err) {
    console.error("Cron crawl error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
