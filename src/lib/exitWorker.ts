import { applyTradeToState } from "./accounting";
import { DEFAULT_SLIPPAGE_BPS, DEFAULT_GAS_BUFFER_BPS, getChainTokens } from "./constants";
import { buildQuotePreview } from "./external";
import { fromBaseUnits, toBaseUnits } from "./money";
import { addExitFailure, getExitFailures, getExitRules, getPortfolio, getPosition, listPositions, recordTrade } from "./repositories";
import type { Position } from "./types";
import { getZeroxPrice } from "./zerox";

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
  if (input.stopLossPct !== null && pnlPct <= -input.stopLossPct) return "sl";
  return null;
}

export function calcExitQuantity(positionQuantity: number, exitSizePct: number): number {
  return positionQuantity * (exitSizePct / 100);
}

const pendingExits = new Set<string>();
let lastCheckedAt = 0;

export async function runExitCheck(): Promise<void> {
  const rules = getExitRules();
  if (!rules.enabled) return;
  if (rules.takeProfitPct === null && rules.stopLossPct === null) return;
  if (Date.now() - lastCheckedAt < rules.checkIntervalSecs * 1000) return;
  lastCheckedAt = Date.now();

  const failures = getExitFailures();
  const failedAddresses = new Set(failures.map((f) => f.tokenAddress));

  const positions = listPositions().filter(
    (p) => p.quantity > 0 && !pendingExits.has(p.tokenAddress) && !failedAddresses.has(p.tokenAddress)
  );
  if (!positions.length) return;

  const byChain = new Map<number, Position[]>();
  for (const pos of positions) {
    const arr = byChain.get(pos.chainId) ?? [];
    arr.push(pos);
    byChain.set(pos.chainId, arr);
  }

  const priceMap = new Map<string, number | null>();
  for (const [chainId, chainPositions] of byChain) {
    const chainTokens = getChainTokens(chainId);
    const sellAmount = toBaseUnits(10, chainTokens.usdc.decimals);
    const results = await Promise.allSettled(
      chainPositions.map(async (pos) => {
        const quote = await getZeroxPrice({
          chainId,
          sellToken: chainTokens.usdc.address,
          buyToken: pos.tokenAddress,
          sellAmount
        });
        const tokensReceived = fromBaseUnits(quote.buyAmount, pos.decimals);
        if (!tokensReceived) throw new Error(`Zero buy amount for ${pos.tokenAddress}`);
        return { address: pos.tokenAddress, priceUsd: 10 / tokensReceived };
      })
    );
    for (let i = 0; i < chainPositions.length; i++) {
      const result = results[i];
      priceMap.set(chainPositions[i].tokenAddress, result.status === "fulfilled" ? result.value.priceUsd : null);
    }
  }

  await Promise.allSettled(
    positions.map(async (pos) => {
      const currentPriceUsd = priceMap.get(pos.tokenAddress) ?? null;
      if (currentPriceUsd === null) return;

      const trigger = checkExitTrigger({
        currentPriceUsd,
        averageEntryUsd: pos.averageEntryUsd,
        takeProfitPct: rules.takeProfitPct,
        stopLossPct: rules.stopLossPct
      });
      if (!trigger) return;

      pendingExits.add(pos.tokenAddress);
      try {
        const tokenQuantity = calcExitQuantity(pos.quantity, rules.exitSizePct);
        const preview = await buildQuotePreview({
          side: "sell",
          token: { address: pos.tokenAddress, chainId: pos.chainId, symbol: pos.symbol, name: pos.name, decimals: pos.decimals, createdAt: "" },
          chainId: pos.chainId,
          tokenQuantity,
          slippageBps: DEFAULT_SLIPPAGE_BPS,
          gasBufferBps: DEFAULT_GAS_BUFFER_BPS
        });

        const freshPosition = getPosition(pos.tokenAddress);
        if (!freshPosition || freshPosition.quantity <= 0) return;

        const portfolio = getPortfolio();
        const next = applyTradeToState({ portfolio, position: freshPosition, preview });

        const pnlPct = ((currentPriceUsd - pos.averageEntryUsd) / pos.averageEntryUsd) * 100;
        const snapshotWithAutoExit = {
          ...preview.quoteSnapshot,
          autoExit: true,
          trigger,
          triggerPct: Math.round(pnlPct * 100) / 100
        };

        recordTrade({
          side: "sell",
          tokenAddress: pos.tokenAddress,
          chainId: pos.chainId,
          quantity: preview.quantity,
          priceUsd: preview.priceUsd,
          notionalUsd: preview.notionalUsd,
          gasUsd: preview.gasUsd,
          slippageUsd: preview.slippageUsd,
          dexFeeUsd: preview.dexFeeUsd,
          totalCostUsd: preview.totalCostUsd,
          realizedPnlUsd: next.realizedPnlUsd,
          quoteSnapshot: JSON.stringify(snapshotWithAutoExit)
        });
      } catch (error) {
        addExitFailure({
          tokenAddress: pos.tokenAddress,
          chainId: pos.chainId,
          symbol: pos.symbol,
          reason: error instanceof Error ? error.message : "Unknown error during auto-exit.",
          failedAt: new Date().toISOString()
        });
      } finally {
        pendingExits.delete(pos.tokenAddress);
      }
    })
  );
}

export function startExitWorker(): void {
  setInterval(() => {
    runExitCheck().catch((err: unknown) => {
      console.error("[exit-worker] Unhandled error in runExitCheck:", err);
    });
  }, 30_000);
}

export function resetWorkerState(): void {
  lastCheckedAt = 0;
  pendingExits.clear();
}
