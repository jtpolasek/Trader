import type { LedgerDelta, LedgerEntry, PortfolioTotals, TradeLedgerInput } from "./types";

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

export function derivePortfolioTotals(entries: LedgerEntry[], startingCashUsd: number): PortfolioTotals {
  let cashUsd = startingCashUsd;
  let realizedPnlUsd = 0;
  let feesPaidUsd = 0;
  for (const item of entries) {
    cashUsd += item.cashDelta;
    realizedPnlUsd += item.realizedPnlDelta;
    feesPaidUsd += item.feeDelta;
  }
  return { cashUsd, realizedPnlUsd, feesPaidUsd };
}

export type PositionAggregate = {
  tokenAddress: string;
  quantity: number;
  averageEntryUsd: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
  updatedAt: string;
};

const OPEN_POSITION_EPSILON = 1e-10;

export function derivePositions(entries: LedgerEntry[]): PositionAggregate[] {
  const byToken = new Map<string, PositionAggregate>();

  for (const item of entries) {
    const current =
      byToken.get(item.tokenAddress) ??
      {
        tokenAddress: item.tokenAddress,
        quantity: 0,
        averageEntryUsd: 0,
        costBasisUsd: 0,
        realizedPnlUsd: 0,
        feesPaidUsd: 0,
        updatedAt: item.createdAt
      };

    current.quantity += item.quantityDelta;
    current.costBasisUsd += item.costBasisDelta;
    current.realizedPnlUsd += item.realizedPnlDelta;
    current.feesPaidUsd += item.feeDelta;
    if (item.createdAt > current.updatedAt) current.updatedAt = item.createdAt;
    byToken.set(item.tokenAddress, current);
  }

  return Array.from(byToken.values())
    .filter((position) => position.quantity > OPEN_POSITION_EPSILON)
    .map((position) => ({
      ...position,
      averageEntryUsd: position.quantity > OPEN_POSITION_EPSILON ? position.costBasisUsd / position.quantity : 0
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
