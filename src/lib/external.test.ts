import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
import { normalizeAlchemyTransfers } from "./external";
import { normalizeZeroxPriceQuote, summarizeZeroxIssues, ZEROX_PRICE_ENDPOINT } from "./zerox";

describe("summarizeZeroxIssues", () => {
  it("surfaces no liquidity as a specific warning", () => {
    expect(summarizeZeroxIssues({ liquidityAvailable: false })).toContain(
      "No usable 0x liquidity or route was found for this token and trade size."
    );
  });

  it("surfaces incomplete simulation separately from liquidity", () => {
    expect(summarizeZeroxIssues({ issues: { simulationIncomplete: true } })).toContain(
      "0x could not fully simulate this swap, so execution may revert or pricing may be unreliable."
    );
  });

  it("does not surface allowance and balance checks in paper mode", () => {
    expect(summarizeZeroxIssues({ issues: { allowance: {}, balance: {} } })).toEqual([]);
  });

  it("keeps unknown issue shapes visible", () => {
    expect(summarizeZeroxIssues({ issues: { unexpected: true } })).toContain(
      "0x returned quote issues that are not yet classified. Treat this simulation as unreliable."
    );
  });
});

describe("normalizeZeroxPriceQuote", () => {
  it("keeps raw 0x data while exposing the internal quote shape", () => {
    const rawQuote = {
      buyAmount: "250000000",
      sellAmount: "100000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: {
        zeroExFee: {
          amount: "1500000",
          token: TOKENS.USDC.address,
          type: "volume"
        }
      }
    };

    const quote = normalizeZeroxPriceQuote(
      {
        sellToken: TOKENS.USDC.address,
        buyToken: "0xtoken",
        sellAmount: "100000000"
      },
      rawQuote
    );

    expect(quote).toMatchObject({
      provider: "0x",
      endpoint: ZEROX_PRICE_ENDPOINT,
      chainId: 1,
      sellToken: TOKENS.USDC.address,
      buyToken: "0xtoken",
      sellAmount: "100000000",
      buyAmount: "250000000",
      gasUnits: 210000,
      gasPriceWei: 30000000000,
      dexFeeUsd: 1.5,
      warnings: []
    });
    expect(quote.rawResponse).toBe(rawQuote);
  });

  it("adds a warning when gas fields are incomplete", () => {
    const quote = normalizeZeroxPriceQuote(
      {
        sellToken: TOKENS.USDC.address,
        buyToken: "0xtoken",
        sellAmount: "100000000"
      },
      { buyAmount: "250000000" }
    );

    expect(quote.warnings).toContain("0x did not return a complete gas estimate; gas may be understated.");
  });
});

describe("normalizeAlchemyTransfers", () => {
  const wallet = "0x6332685fb57d440b9812cc5f625376f8bee6eba1";

  it("keeps both incoming and outgoing wallet transfers", () => {
    const activity = normalizeAlchemyTransfers(wallet, [
      {
        hash: "0xout",
        category: "erc20",
        asset: "USDC",
        value: 12,
        from: wallet,
        to: "0x0000000000000000000000000000000000000001",
        blockNum: "0x1",
        metadata: { blockTimestamp: "2026-06-03T00:00:00.000Z" }
      },
      {
        hash: "0xin",
        category: "external",
        asset: "ETH",
        value: 0.25,
        from: "0x0000000000000000000000000000000000000002",
        to: wallet,
        blockNum: "0x2",
        metadata: { blockTimestamp: "2026-06-03T00:01:00.000Z" }
      }
    ]);

    expect(activity).toHaveLength(2);
    expect(activity.map((item) => item.hash)).toEqual(["0xout", "0xin"]);
    expect(activity.every((item) => item.walletAddress === wallet)).toBe(true);
  });

  it("dedupes identical transfers and marks grouped hashes as swap-like", () => {
    const activity = normalizeAlchemyTransfers(wallet, [
      {
        hash: "0xswap",
        category: "erc20",
        asset: "TOKEN",
        value: 100,
        from: wallet,
        to: "0x0000000000000000000000000000000000000001"
      },
      {
        hash: "0xswap",
        category: "erc20",
        asset: "TOKEN",
        value: 100,
        from: wallet,
        to: "0x0000000000000000000000000000000000000001"
      },
      {
        hash: "0xswap",
        category: "erc20",
        asset: "USDC",
        value: 5,
        from: "0x0000000000000000000000000000000000000001",
        to: wallet
      }
    ]);

    expect(activity).toHaveLength(2);
    expect(activity.every((item) => item.isSwapLike)).toBe(true);
  });
});
