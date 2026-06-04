import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
import { normalizeAlchemyTransfers } from "./external";
import { getZeroxPrice, normalizeZeroxPriceQuote, summarizeZeroxIssues, ZEROX_PRICE_ENDPOINT } from "./zerox";

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

  it("zeroes malformed gas and fee values instead of throwing", () => {
    const quote = normalizeZeroxPriceQuote(
      {
        sellToken: TOKENS.USDC.address,
        buyToken: "0xtoken",
        sellAmount: "100000000"
      },
      {
        buyAmount: "250000000",
        gas: "not-a-number",
        gasPrice: "also-bad",
        fees: {
          zeroExFee: {
            amount: "not-base-units",
            token: TOKENS.USDC.address,
            type: "volume"
          }
        }
      }
    );

    expect(quote.gasUnits).toBe(0);
    expect(quote.gasPriceWei).toBe(0);
    expect(quote.dexFeeUsd).toBe(0);
    expect(quote.warnings).toContain("0x did not return a complete gas estimate; gas may be understated.");
  });

  it("ignores non-USDC fee amounts in the USD fee estimate", () => {
    const quote = normalizeZeroxPriceQuote(
      {
        sellToken: TOKENS.USDC.address,
        buyToken: "0xtoken",
        sellAmount: "100000000"
      },
      {
        buyAmount: "250000000",
        gas: "210000",
        gasPrice: "30000000000",
        fees: {
          zeroExFee: {
            amount: "1000000000000000000",
            token: TOKENS.WETH.address,
            type: "volume"
          }
        }
      }
    );

    expect(quote.dexFeeUsd).toBe(0);
  });
});

describe("getZeroxPrice", () => {
  it("fails clearly when the 0x API key is missing", async () => {
    const originalApiKey = process.env.ZEROX_API_KEY;
    delete process.env.ZEROX_API_KEY;

    await expect(
      getZeroxPrice({
        sellToken: TOKENS.USDC.address,
        buyToken: TOKENS.WETH.address,
        sellAmount: "100000000"
      })
    ).rejects.toThrow("ZEROX_API_KEY is required to request swap prices.");

    if (originalApiKey) {
      process.env.ZEROX_API_KEY = originalApiKey;
    }
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
    expect(activity.every((item) => item.chainName === "Ethereum")).toBe(true);
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

  it("keeps same-hash activity distinct across chains", () => {
    const activity = normalizeAlchemyTransfers(wallet, [
      {
        chainId: 1,
        chainName: "Ethereum",
        hash: "0xsamehash",
        category: "erc20",
        asset: "USDC",
        value: 10,
        from: wallet,
        to: "0x0000000000000000000000000000000000000001"
      },
      {
        chainId: 8453,
        chainName: "Base",
        hash: "0xsamehash",
        category: "erc20",
        asset: "USDC",
        value: 10,
        from: wallet,
        to: "0x0000000000000000000000000000000000000001"
      }
    ]);

    expect(activity).toHaveLength(2);
    expect(activity.map((item) => item.chainName)).toEqual(["Ethereum", "Base"]);
  });
});
