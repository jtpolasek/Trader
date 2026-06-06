export function isQuoteStale(fetchedAt: number, now: number, thresholdMs: number): boolean {
  return now - fetchedAt > thresholdMs;
}
