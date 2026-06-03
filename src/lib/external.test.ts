import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
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
