import { describe, expect, it } from "vitest";
import { derivePortfolioAnalytics } from "./portfolioAnalytics";
import type { Portfolio, Position, Trade } from "./types";

const basePortfolio: Portfolio = {
  id: "default",
  name: "Main Paper Account",
  cashUsd: 10_000,
  startingCashUsd: 10_000,
  realizedPnlUsd: 0,
  feesPaidUsd: 0,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};

describe("derivePortfolioAnalytics", () => {
  it("returns neutral analytics when there are no trades", () => {
    expect(derivePortfolioAnalytics({ portfolio: basePortfolio, positions: [], trades: [] })).toEqual({
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: null,
      feeDrag: null,
      averageHoldHours: null,
      openExposureUsd: 0,
      realizedPnlUsd: 0,
      bestToken: null,
      worstToken: null
    });
  });

  it("computes win rate and best and worst realized tokens from closed trades", () => {
    const analytics = derivePortfolioAnalytics({
      portfolio: { ...basePortfolio, realizedPnlUsd: 15 },
      positions: [],
      trades: [
        trade({ id: "sell-win", side: "sell", symbol: "AAA", realizedPnlUsd: 40, createdAt: "2026-06-03T00:00:00.000Z" }),
        trade({ id: "sell-loss", side: "sell", symbol: "BBB", realizedPnlUsd: -25, createdAt: "2026-06-04T00:00:00.000Z" }),
        trade({ id: "buy-open", side: "buy", symbol: "CCC", realizedPnlUsd: 0, createdAt: "2026-06-05T00:00:00.000Z" })
      ]
    });

    expect(analytics.closedTrades).toBe(2);
    expect(analytics.winningTrades).toBe(1);
    expect(analytics.losingTrades).toBe(1);
    expect(analytics.winRate).toBe(0.5);
    expect(analytics.realizedPnlUsd).toBe(15);
    expect(analytics.bestToken).toEqual({ symbol: "AAA", realizedPnlUsd: 40 });
    expect(analytics.worstToken).toEqual({ symbol: "BBB", realizedPnlUsd: -25 });
  });

  it("computes fee drag from total fees over traded notional", () => {
    const analytics = derivePortfolioAnalytics({
      portfolio: { ...basePortfolio, feesPaidUsd: 12 },
      positions: [],
      trades: [
        trade({ id: "buy", notionalUsd: 100, gasUsd: 5, slippageUsd: 1, dexFeeUsd: 0 }),
        trade({ id: "sell", side: "sell", notionalUsd: 200, gasUsd: 4, slippageUsd: 1, dexFeeUsd: 1 })
      ]
    });

    expect(analytics.feeDrag).toBeCloseTo(0.04);
  });

  it("computes FIFO average hold time for closed quantity", () => {
    const analytics = derivePortfolioAnalytics({
      portfolio: basePortfolio,
      positions: [position({ tokenAddress: "0xaaa", symbol: "AAA", costBasisUsd: 50 })],
      trades: [
        trade({
          id: "buy-1",
          tokenAddress: "0xaaa",
          symbol: "AAA",
          side: "buy",
          quantity: 10,
          createdAt: "2026-06-01T00:00:00.000Z"
        }),
        trade({
          id: "buy-2",
          tokenAddress: "0xaaa",
          symbol: "AAA",
          side: "buy",
          quantity: 10,
          createdAt: "2026-06-02T00:00:00.000Z"
        }),
        trade({
          id: "sell-1",
          tokenAddress: "0xaaa",
          symbol: "AAA",
          side: "sell",
          quantity: 15,
          realizedPnlUsd: 20,
          createdAt: "2026-06-03T00:00:00.000Z"
        })
      ]
    });

    expect(analytics.averageHoldHours).toBeCloseTo(40);
    expect(analytics.openExposureUsd).toBe(50);
  });
});

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: "trade",
    side: "buy",
    tokenAddress: "0x0000000000000000000000000000000000000001",
    chainId: 1,
    symbol: "TKN",
    quantity: 10,
    priceUsd: 10,
    notionalUsd: 100,
    gasUsd: 0,
    slippageUsd: 0,
    dexFeeUsd: 0,
    totalCostUsd: 100,
    realizedPnlUsd: 0,
    quoteSnapshot: "{}",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

function position(overrides: Partial<Position>): Position {
  return {
    tokenAddress: "0x0000000000000000000000000000000000000001",
    chainId: 1,
    symbol: "TKN",
    name: "Token",
    decimals: 18,
    quantity: 10,
    averageEntryUsd: 10,
    costBasisUsd: 100,
    realizedPnlUsd: 0,
    feesPaidUsd: 0,
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}
