import type { Portfolio, PortfolioAnalytics, PortfolioAnalyticsTokenResult, Position, Trade } from "./types";

type AnalyticsInput = {
  portfolio: Portfolio;
  positions: Position[];
  trades: Trade[];
};

type OpenLot = {
  tokenAddress: string;
  quantity: number;
  openedAtMs: number;
};

export function derivePortfolioAnalytics({ portfolio, positions, trades }: AnalyticsInput): PortfolioAnalytics {
  const closedTrades = trades.filter((trade) => trade.side === "sell");
  const winningTrades = closedTrades.filter((trade) => trade.realizedPnlUsd > 0).length;
  const losingTrades = closedTrades.filter((trade) => trade.realizedPnlUsd < 0).length;
  const totalNotionalUsd = trades.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const totalFeesUsd = trades.reduce((sum, trade) => sum + trade.gasUsd + trade.slippageUsd + trade.dexFeeUsd, 0);
  const realizedByToken = realizedPnlByToken(closedTrades);

  return {
    closedTrades: closedTrades.length,
    winningTrades,
    losingTrades,
    winRate: closedTrades.length ? winningTrades / closedTrades.length : null,
    feeDrag: totalNotionalUsd > 0 ? totalFeesUsd / totalNotionalUsd : null,
    averageHoldHours: averageHoldHours(trades),
    openExposureUsd: positions.reduce((sum, position) => sum + position.costBasisUsd, 0),
    realizedPnlUsd: portfolio.realizedPnlUsd,
    bestToken: bestToken(realizedByToken),
    worstToken: worstToken(realizedByToken)
  };
}

function realizedPnlByToken(trades: Trade[]) {
  const totals = new Map<string, PortfolioAnalyticsTokenResult>();
  for (const trade of trades) {
    const current = totals.get(trade.symbol) ?? { symbol: trade.symbol, realizedPnlUsd: 0 };
    current.realizedPnlUsd += trade.realizedPnlUsd;
    totals.set(trade.symbol, current);
  }
  return Array.from(totals.values());
}

function bestToken(tokens: PortfolioAnalyticsTokenResult[]) {
  if (!tokens.length) return null;
  return tokens.reduce((best, token) => (token.realizedPnlUsd > best.realizedPnlUsd ? token : best));
}

function worstToken(tokens: PortfolioAnalyticsTokenResult[]) {
  if (!tokens.length) return null;
  return tokens.reduce((worst, token) => (token.realizedPnlUsd < worst.realizedPnlUsd ? token : worst));
}

function averageHoldHours(trades: Trade[]) {
  const lots: OpenLot[] = [];
  let weightedHours = 0;
  let closedQuantity = 0;

  for (const trade of [...trades].sort((a, b) => timestampMs(a.createdAt) - timestampMs(b.createdAt))) {
    const tradeTime = timestampMs(trade.createdAt);
    if (!Number.isFinite(tradeTime)) continue;

    if (trade.side === "buy") {
      lots.push({ tokenAddress: trade.tokenAddress, quantity: trade.quantity, openedAtMs: tradeTime });
      continue;
    }

    let remaining = trade.quantity;
    for (const lot of lots) {
      if (remaining <= 1e-10) break;
      if (lot.tokenAddress !== trade.tokenAddress || lot.quantity <= 1e-10) continue;

      const matched = Math.min(remaining, lot.quantity);
      const hours = (tradeTime - lot.openedAtMs) / 3_600_000;
      if (hours >= 0) {
        weightedHours += hours * matched;
        closedQuantity += matched;
      }
      lot.quantity -= matched;
      remaining -= matched;
    }
  }

  return closedQuantity > 0 ? weightedHours / closedQuantity : null;
}

function timestampMs(value: string) {
  return new Date(value).getTime();
}
