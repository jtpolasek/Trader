import { describe, expect, it } from "vitest";
import { applyTradeToState } from "./accounting";
import type { Portfolio, Position, QuotePreview, Token } from "./types";

const token: Token = {
  address: "0xtoken",
  symbol: "TKN",
  name: "Token",
  decimals: 18,
  createdAt: "now"
};

const portfolio: Portfolio = {
  id: "default",
  name: "Main",
  cashUsd: 10_000,
  startingCashUsd: 10_000,
  realizedPnlUsd: 0,
  feesPaidUsd: 0,
  createdAt: "now",
  updatedAt: "now"
};

function preview(overrides: Partial<QuotePreview>): QuotePreview {
  return {
    side: "buy",
    token,
    quantity: 10,
    priceUsd: 10,
    notionalUsd: 100,
    gasUsd: 5,
    slippageUsd: 1,
    dexFeeUsd: 0,
    totalCostUsd: 106,
    sellProceedsUsd: 0,
    warnings: [],
    quoteSnapshot: {},
    ...overrides
  };
}

describe("applyTradeToState", () => {
  it("averages entries across multiple buys including fees", () => {
    const first = applyTradeToState({ portfolio, position: null, preview: preview({}) });
    const second = applyTradeToState({
      portfolio: { ...portfolio, cashUsd: first.portfolio.cashUsd, feesPaidUsd: first.portfolio.feesPaidUsd },
      position: { ...basePosition(), ...first.position },
      preview: preview({ quantity: 5, notionalUsd: 75, totalCostUsd: 83, gasUsd: 6, slippageUsd: 2 })
    });

    expect(second.position.quantity).toBe(15);
    expect(second.position.costBasisUsd).toBe(189);
    expect(second.position.averageEntryUsd).toBeCloseTo(12.6);
    expect(second.portfolio.cashUsd).toBe(9811);
  });

  it("realizes PnL after fees on partial sells", () => {
    const position: Position = {
      ...basePosition(),
      quantity: 10,
      averageEntryUsd: 10,
      costBasisUsd: 100
    };

    const result = applyTradeToState({
      portfolio,
      position,
      preview: preview({
        side: "sell",
        quantity: 4,
        notionalUsd: 60,
        gasUsd: 3,
        slippageUsd: 1,
        totalCostUsd: 4,
        sellProceedsUsd: 56
      })
    });

    expect(result.realizedPnlUsd).toBe(16);
    expect(result.position.quantity).toBe(6);
    expect(result.position.costBasisUsd).toBe(60);
    expect(result.portfolio.cashUsd).toBe(10_056);
  });

  it("rejects buys that cannot cover all-in cost", () => {
    expect(() =>
      applyTradeToState({
        portfolio: { ...portfolio, cashUsd: 50 },
        position: null,
        preview: preview({})
      })
    ).toThrow("Insufficient paper cash");
  });

  it("rejects sells above held quantity", () => {
    expect(() =>
      applyTradeToState({
        portfolio,
        position: { ...basePosition(), quantity: 1 },
        preview: preview({ side: "sell", quantity: 2, sellProceedsUsd: 20 })
      })
    ).toThrow("Insufficient token balance");
  });
});

function basePosition(): Position {
  return {
    tokenAddress: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    quantity: 0,
    averageEntryUsd: 0,
    costBasisUsd: 0,
    realizedPnlUsd: 0,
    feesPaidUsd: 0,
    updatedAt: "now"
  };
}
