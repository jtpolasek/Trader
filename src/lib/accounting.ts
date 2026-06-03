import type { Portfolio, Position, QuotePreview } from "./types";

export function applyTradeToState(input: {
  portfolio: Portfolio;
  position: Position | null;
  preview: QuotePreview;
}) {
  const { portfolio, position, preview } = input;
  const fees = preview.gasUsd + preview.slippageUsd + preview.dexFeeUsd;

  if (preview.side === "buy") {
    if (portfolio.cashUsd < preview.totalCostUsd) {
      throw new Error("Insufficient paper cash for this buy after fees.");
    }
    const existingQuantity = position?.quantity ?? 0;
    const existingCost = position?.costBasisUsd ?? 0;
    const nextQuantity = existingQuantity + preview.quantity;
    const nextCost = existingCost + preview.notionalUsd + fees;

    return {
      portfolio: {
        cashUsd: portfolio.cashUsd - preview.totalCostUsd,
        realizedPnlUsd: portfolio.realizedPnlUsd,
        feesPaidUsd: portfolio.feesPaidUsd + fees
      },
      position: {
        quantity: nextQuantity,
        averageEntryUsd: nextQuantity > 0 ? nextCost / nextQuantity : 0,
        costBasisUsd: nextCost,
        realizedPnlUsd: position?.realizedPnlUsd ?? 0,
        feesPaidUsd: (position?.feesPaidUsd ?? 0) + fees
      },
      realizedPnlUsd: 0
    };
  }

  if (!position || position.quantity < preview.quantity) {
    throw new Error("Insufficient token balance for this sell.");
  }

  const costPortion = position.averageEntryUsd * preview.quantity;
  const realizedPnlUsd = preview.sellProceedsUsd - costPortion;
  const nextQuantity = position.quantity - preview.quantity;
  const nextCostBasis = Math.max(0, position.costBasisUsd - costPortion);

  return {
    portfolio: {
      cashUsd: portfolio.cashUsd + preview.sellProceedsUsd,
      realizedPnlUsd: portfolio.realizedPnlUsd + realizedPnlUsd,
      feesPaidUsd: portfolio.feesPaidUsd + fees
    },
    position: {
      quantity: nextQuantity,
      averageEntryUsd: nextQuantity > 0 ? nextCostBasis / nextQuantity : 0,
      costBasisUsd: nextQuantity > 0 ? nextCostBasis : 0,
      realizedPnlUsd: position.realizedPnlUsd + realizedPnlUsd,
      feesPaidUsd: position.feesPaidUsd + fees
    },
    realizedPnlUsd
  };
}
