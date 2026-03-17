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
  const chunkSize = 375; // ~500 tokens
  const overlap = 37; // ~50 tokens
  const chunks: DocChunk[] = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const slice = words.slice(i, i + chunkSize);
    if (slice.length < 20) break; // skip tiny tail chunks
    chunks.push({
      content: slice.join(" "),
      source_url: sourceUrl,
      page_title: pageTitle,
    });
  }

  return chunks;
}
