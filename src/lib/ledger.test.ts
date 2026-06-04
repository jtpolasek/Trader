import { describe, expect, it } from "vitest";
import { ledgerDeltaFromTrade } from "./ledger";
import type { TradeLedgerInput } from "./types";

function trade(overrides: Partial<TradeLedgerInput>): TradeLedgerInput {
  return {
    side: "buy",
    quantity: 10,
    priceUsd: 10,
    notionalUsd: 100,
    gasUsd: 5,
    slippageUsd: 1,
    dexFeeUsd: 0,
    totalCostUsd: 106,
    realizedPnlUsd: 0,
    ...overrides
  };
}

describe("ledgerDeltaFromTrade", () => {
  it("derives a buy delta with fees folded into cost basis", () => {
    expect(ledgerDeltaFromTrade(trade({}))).toEqual({
      entryType: "buy",
      cashDelta: -106,
      quantityDelta: 10,
      costBasisDelta: 106,
      realizedPnlDelta: 0,
      feeDelta: 6
    });
  });

  it("derives a sell delta with proceeds net of fees", () => {
    const delta = ledgerDeltaFromTrade(
      trade({ side: "sell", quantity: 4, notionalUsd: 60, gasUsd: 3, slippageUsd: 1, dexFeeUsd: 0, totalCostUsd: 4, realizedPnlUsd: 16 })
    );
    expect(delta).toEqual({
      entryType: "sell",
      cashDelta: 56,
      quantityDelta: -4,
      costBasisDelta: -40,
      realizedPnlDelta: 16,
      feeDelta: 4
    });
  });

  it("classifies a zero-price sell as a total loss", () => {
    const delta = ledgerDeltaFromTrade(
      trade({ side: "sell", quantity: 100, priceUsd: 0, notionalUsd: 0, gasUsd: 0, slippageUsd: 0, dexFeeUsd: 0, totalCostUsd: 0, realizedPnlUsd: -200 })
    );
    expect(delta).toEqual({
      entryType: "total_loss",
      cashDelta: 0,
      quantityDelta: -100,
      costBasisDelta: -200,
      realizedPnlDelta: -200,
      feeDelta: 0
    });
  });
});
