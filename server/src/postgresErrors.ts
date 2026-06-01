/** True when Postgres cannot grow a table file (Railway volume full). */
export function isPostgresDiskFullError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) {
    return false;
  }
  if (e.code === "53100") {
    return true;
  }
  const msg = e.message ?? "";
  return msg.includes("No space left on device") || msg.includes("could not extend file");
}
