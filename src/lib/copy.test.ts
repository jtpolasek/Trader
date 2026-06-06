import { describe, expect, it } from "vitest";
import { DEFAULT_COPY_SETTINGS } from "./constants";
import { calculateCashCappedBuyUsd, classifyCopyError, describeCopyError, estimateSourceNotionalUsd, sizeCopyTrade } from "./copy";
import type { CopySettings, Position, TradeCandidate } from "./types";

const settings: CopySettings = { ...DEFAULT_COPY_SETTINGS };

function candidate(overrides: Partial<TradeCandidate>): TradeCandidate {
  return {
    id: "candidate",
    walletAddress: "0xwallet",
    chainId: 8453,
    chainName: "Base",
    hash: "0xhash",
    status: "decoded",
    confidence: 0.9,
    side: "buy",
    tokenInAsset: "USDC",
    tokenInAddress: "0xusdc",
    tokenInAmount: 100,
    tokenOutAsset: "TOKEN",
    tokenOutAddress: "0x0000000000000000000000000000000000001000",
    tokenOutAmount: 1000,
    reason: "Likely swap",
    transferCount: 2,
    sourceTimestamp: "2026-06-04T00:00:00.000Z",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

describe("estimateSourceNotionalUsd", () => {
  it("uses cash input for buys", () => {
    expect(estimateSourceNotionalUsd(candidate({}), 3000)).toBe(100);
  });

  it("uses native input for buys", () => {
    expect(estimateSourceNotionalUsd(candidate({ tokenInAsset: "ETH", tokenInAmount: 0.1 }), 3000)).toBe(300);
  });
});

describe("describeCopyError", () => {
  it("summarizes no-liquidity copy failures", () => {
    expect(describeCopyError(new Error("No usable 0x liquidity/route for this buy."))).toBe(
      "No usable 0x liquidity or route was found for this copied trade size."
    );
  });

  it("keeps insufficient cash copy failures specific", () => {
    expect(describeCopyError(new Error("Insufficient paper cash for this copy after fees."))).toBe(
      "Insufficient paper cash for this copy after fees."
    );
  });

  it("summarizes missing paper position sell failures", () => {
    expect(describeCopyError(new Error("This sell candidate cannot be copied because the paper portfolio has no matching position."))).toBe(
      "This sell candidate cannot be copied because the paper portfolio has no matching position."
    );
  });
});

describe("classifyCopyError", () => {
  it.each([
    ["This candidate has no token contract address to copy.", "missing-token-address"],
    ["This token is not on the copy allowlist.", "blocked-token"],
    ["This token is on the copy blocklist.", "blocked-token"],
    ["No usable 0x liquidity/route for this buy.", "no-liquidity"],
    ["Insufficient paper cash for this copy after fees.", "insufficient-cash"],
    ["This sell candidate cannot be copied because the paper portfolio has no matching position.", "missing-position"],
    ["Only buy or sell candidates can be copied.", "unsupported-pattern"],
    ["Candidate has already been copied.", "already-copied"]
  ])("classifies %s as %s", (message, bucket) => {
    expect(classifyCopyError(new Error(message)).bucket).toBe(bucket);
  });
});

describe("sizeCopyTrade", () => {
  it("sizes fixed-dollar buys with a max cap", () => {
    const sized = sizeCopyTrade({
      candidate: candidate({}),
      settings: { ...settings, mode: "fixedUsd", fixedUsd: 250, maxTradeUsd: 100 },
      nativeUsd: 3000,
      position: null
    });

    expect(sized).toMatchObject({
      side: "buy",
      tokenAddress: "0x0000000000000000000000000000000000001000",
      usdAmount: 100
    });
  });

  it("sizes percent-of-source buys", () => {
    const sized = sizeCopyTrade({
      candidate: candidate({ tokenInAmount: 200 }),
      settings: { ...settings, mode: "percentOfSource", percentOfSource: 25, maxTradeUsd: 500 },
      nativeUsd: 3000,
      position: null
    });

    expect(sized).toMatchObject({ side: "buy", usdAmount: 50, sourceNotionalUsd: 200 });
  });

  it("rejects blocked tokens", () => {
    expect(() =>
      sizeCopyTrade({
        candidate: candidate({}),
        settings: { ...settings, blocklist: ["0x0000000000000000000000000000000000001000"] },
        nativeUsd: 3000,
        position: null
      })
    ).toThrow("blocklist");
  });

  it("requires a position for copied sells", () => {
    expect(() =>
      sizeCopyTrade({
        candidate: candidate({
          side: "sell",
          tokenInAsset: "TOKEN",
          tokenInAddress: "0x0000000000000000000000000000000000001000",
          tokenInAmount: 20,
          tokenOutAsset: "USDC",
          tokenOutAmount: 100
        }),
        settings,
        nativeUsd: 3000,
        position: null
      })
    ).toThrow("no matching position");
  });

  it("caps copied sells to the current position quantity", () => {
    const position: Position = {
      tokenAddress: "0x0000000000000000000000000000000000001000",
      chainId: 8453,
      symbol: "TOKEN",
      name: "TOKEN",
      decimals: 18,
      quantity: 5,
      averageEntryUsd: 10,
      costBasisUsd: 50,
      realizedPnlUsd: 0,
      feesPaidUsd: 0,
      updatedAt: "2026-06-04T00:00:00.000Z"
    };
    const sized = sizeCopyTrade({
      candidate: candidate({
        side: "sell",
        tokenInAsset: "TOKEN",
        tokenInAddress: position.tokenAddress,
        tokenInAmount: 20,
        tokenOutAsset: "USDC",
        tokenOutAmount: 100
      }),
      settings: { ...settings, mode: "percentOfSource", percentOfSource: 100, maxTradeUsd: 500 },
      nativeUsd: 3000,
      position
    });

    expect(sized).toMatchObject({ side: "sell", tokenQuantity: 5 });
  });
});

describe("calculateCashCappedBuyUsd", () => {
  it("reserves fixed fees, slippage, and a safety buffer", () => {
    const capped = calculateCashCappedBuyUsd({
      cashUsd: 100,
      requestedUsd: 250,
      gasUsd: 10,
      dexFeeUsd: 2,
      slippageBps: 100,
      safetyBufferBps: 0
    });

    expect(capped).toBeCloseTo(87.1287, 4);
  });

  it("does not increase an already affordable request", () => {
    expect(
      calculateCashCappedBuyUsd({
        cashUsd: 1000,
        requestedUsd: 100,
        gasUsd: 5,
        dexFeeUsd: 0,
        slippageBps: 50
      })
    ).toBe(100);
  });

  it("returns zero when fixed fees consume available cash", () => {
    expect(
      calculateCashCappedBuyUsd({
        cashUsd: 5,
        requestedUsd: 100,
        gasUsd: 6,
        dexFeeUsd: 0,
        slippageBps: 50
      })
    ).toBe(0);
  });
});
