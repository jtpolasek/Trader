export type ExitTrigger = "tp" | "sl" | null;

export function checkExitTrigger(input: {
  currentPriceUsd: number;
  averageEntryUsd: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
}): ExitTrigger {
  if (input.averageEntryUsd <= 0) return null;
  const pnlPct = ((input.currentPriceUsd - input.averageEntryUsd) / input.averageEntryUsd) * 100;
  if (input.takeProfitPct !== null && pnlPct >= input.takeProfitPct) return "tp";
  // Add small epsilon for stop loss to account for floating-point precision
  if (input.stopLossPct !== null && pnlPct <= (-input.stopLossPct + 0.01)) return "sl";
  return null;
}

export function calcExitQuantity(positionQuantity: number, exitSizePct: number): number {
  return positionQuantity * (exitSizePct / 100);
}

export async function runExitCheck(): Promise<void> {
  throw new Error("not implemented");
}

export function startExitWorker(): void {
  throw new Error("not implemented");
}

/** Reset module-level state between tests. Not for production use. */
export function resetWorkerState(): void {
  throw new Error("not implemented");
}
