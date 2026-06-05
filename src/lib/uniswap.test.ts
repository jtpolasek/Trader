import { describe, expect, it } from "vitest";
import { normalizeUniswapQuote, summarizeUniswapIssues } from "./uniswap";

describe("normalizeUniswapQuote", () => {
  it("normalizes quote amounts, provider metadata, and USD gas", () => {
    const rawQuote = {
      routing: "CLASSIC",
      quote: {
        chainId: 8453,
        input: {
          amount: "100000000",
          token: "0xusdc"
        },
        output: {
          amount: "250000000000000000000",
          token: "0xtoken"
        },
        classicGasUseEstimateUSD: "0.42"
      }
    };

    const quote = normalizeUniswapQuote(
      {
        chainId: 8453,
        sellToken: "0xusdc",
        buyToken: "0xtoken",
        sellAmount: "100000000",
        slippageBps: 100
      },
      rawQuote
    );

    expect(quote).toMatchObject({
      provider: "Uniswap",
      endpoint: "/quote",
      chainId: 8453,
      sellToken: "0xusdc",
      buyToken: "0xtoken",
      sellAmount: "100000000",
      buyAmount: "250000000000000000000",
      gasUsd: 0.42,
      dexFeeUsd: 0,
      warnings: []
    });
    expect(quote.rawResponse).toBe(rawQuote);
  });
});

describe("summarizeUniswapIssues", () => {
  it("surfaces missing route responses", () => {
    expect(summarizeUniswapIssues({ detail: "No quotes available" })).toEqual([
      "No usable Uniswap route was found for this token and trade size."
    ]);
  });

  it("keeps unknown warnings visible", () => {
    expect(summarizeUniswapIssues({ txFailureReason: "SIMULATION_FAILED" })).toEqual([
      "Uniswap returned a quote warning: SIMULATION_FAILED"
    ]);
  });
});
