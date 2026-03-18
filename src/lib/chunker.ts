export interface DocChunk {
  content: string;
  source_url: string;
  page_title: string;
}

export function chunkDocument(html: string, sourceUrl: string): DocChunk[] {
  // Extract title from <title> or <h1>
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i) || html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : sourceUrl;

  // Strip HTML tags
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return [];

  const words = text.split(" ");
  // Chunk size: 375 words ≈ 500 tokens at ~1.33 words/token (English prose).
  // 500 tokens keeps each chunk well within the 8192-token context limit of
  // text-embedding-3-small while remaining large enough to contain a coherent
  // semantic unit (a product feature, a security section, a pricing paragraph).
  //
  // Overlap: 37 words ≈ 50 tokens (10% of chunk size). Overlap prevents a
  // sentence that straddles a chunk boundary from being semantically split
  // across two embeddings. Without overlap, a retrieval query about "SOC 2
  // audit logging" could miss a chunk where "SOC 2" ends one chunk and
  // "audit logging" begins the next.
  const chunkSize = 375;
  const overlap = 37;
  const chunks: DocChunk[] = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    // Drop tail chunks shorter than 20 words. Sub-20-word fragments have low
    // semantic density — they're typically navigation text, footers, or truncated
    // sentences. Including them pollutes the vector index with low-signal embeddings
    // that can rank above substantive chunks on short queries.
    if (slice.length < 20) break;
    chunks.push({
      content: slice.join(" "),
      source_url: sourceUrl,
      page_title: pageTitle,
    });
  }

  return chunks;
}
