/** Skip duplicate AI dispatch when simulcast (or bridges) fan the same audio to several channels. */

const WINDOW_MS = 12_000;
const recentByAgency = new Map<string, number>();

function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function shouldSkipDuplicateAiDispatch(agencyId: number, transcript: string): boolean {
  const norm = normalizeTranscript(transcript);
  if (!norm) {
    return false;
  }
  const key = `${agencyId}:${norm}`;
  const now = Date.now();
  const prev = recentByAgency.get(key);
  recentByAgency.set(key, now);
  if (prev != null && now - prev < WINDOW_MS) {
    return true;
  }
  if (recentByAgency.size > 500) {
    for (const [k, ts] of recentByAgency) {
      if (now - ts > WINDOW_MS) {
        recentByAgency.delete(k);
      }
    }
  }
  return false;
}
