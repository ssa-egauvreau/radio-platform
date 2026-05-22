// Splits extracted document text into overlapping chunks small enough to embed
// and inject individually. Overlap preserves context that would otherwise be
// cut mid-sentence at a chunk boundary.

const CHUNK_SIZE = Number(process.env.KB_CHUNK_CHARS) || 800;
const CHUNK_OVERLAP = Number(process.env.KB_CHUNK_OVERLAP) || 150;

/**
 * Greedy chunker: accumulates whitespace-delimited tokens up to ~CHUNK_SIZE
 * characters, then starts the next chunk with a CHUNK_OVERLAP-character tail of
 * the previous one. Returns [] for empty input.
 */
export function chunkText(
  text: string,
  opts: { size?: number; overlap?: number } = {},
): string[] {
  const size = Math.max(50, opts.size ?? CHUNK_SIZE);
  const overlap = Math.max(0, Math.min(opts.overlap ?? CHUNK_OVERLAP, size - 1));

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  if (normalized.length <= size) {
    return [normalized];
  }

  const words = normalized.split(" ");
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > size && current) {
      chunks.push(current);
      const tail = current.slice(Math.max(0, current.length - overlap));
      // Resume from a word boundary inside the overlap tail to avoid a partial word.
      const boundary = tail.indexOf(" ");
      current = boundary >= 0 ? `${tail.slice(boundary + 1)} ${word}`.trim() : word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}
