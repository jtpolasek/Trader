import type { LedgerDelta, TradeLedgerInput } from "./types";

export function ledgerDeltaFromTrade(trade: TradeLedgerInput): LedgerDelta {
  const fees = trade.gasUsd + trade.slippageUsd + trade.dexFeeUsd;

  if (trade.side === "buy") {
    return {
      entryType: "buy",
      cashDelta: -trade.totalCostUsd,
      quantityDelta: trade.quantity,
      costBasisDelta: trade.notionalUsd + fees,
      realizedPnlDelta: 0,
      feeDelta: fees
    };
  }

  const proceeds = Math.max(0, trade.notionalUsd - fees);
  const isTotalLoss = trade.priceUsd === 0 && trade.notionalUsd === 0;

  return {
    entryType: isTotalLoss ? "total_loss" : "sell",
    cashDelta: proceeds,
    quantityDelta: -trade.quantity,
    costBasisDelta: -(proceeds - trade.realizedPnlUsd),
    realizedPnlDelta: trade.realizedPnlUsd,
    feeDelta: fees
  };
}
