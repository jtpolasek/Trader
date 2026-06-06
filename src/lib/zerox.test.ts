import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
import { summarizeDexFees, normalizeZeroxPriceQuote } from "./zerox";

describe("summarizeDexFees", () => {
  it("prices USDC-denominated fees and reports nothing unpriced", () => {
    const result = summarizeDexFees({
      fees: { zeroExFee: { amount: "1500000", token: TOKENS.USDC.address, type: "volume" } }
    });
    expect(result.dexFeeUsd).toBe(1.5);
    expect(result.unpriced).toEqual([]);
  });

  it("flags a buy-token-denominated 0x fee as unpriced without crediting it", () => {
    const result = summarizeDexFees({
      fees: { zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" } }
    });
    expect(result.dexFeeUsd).toBe(0);
    expect(result.unpriced).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" }
    ]);
  });

  it("does not flag a non-USDC gasFee as unpriced", () => {
    const result = summarizeDexFees({
      fees: { gasFee: { amount: "5000000000000000000", token: "0xweth", type: "gas" } }
    });
    expect(result.unpriced).toEqual([]);
  });

  it("returns no fees when none are present", () => {
    expect(summarizeDexFees({})).toEqual({ dexFeeUsd: 0, unpriced: [] });
  });

  it("ignores zero or unparseable fee amounts", () => {
    const result = summarizeDexFees({
      fees: {
        zeroExFee: { amount: "0", token: "0xtoken", type: "volume" },
        integratorFee: { amount: "not-a-number", token: "0xtoken", type: "volume" }
      }
    });
    expect(result.unpriced).toEqual([]);
  });

  it("skips a fee with no token instead of emitting an empty token", () => {
    const result = summarizeDexFees({
      fees: { zeroExFee: { amount: "5000000000000000000", type: "volume" } }
    });
    expect(result.unpriced).toEqual([]);
  });

  it("prices USDC fees and flags non-USDC fees in the same quote", () => {
    const result = summarizeDexFees({
      fees: {
        integratorFee: { amount: "1000000", token: TOKENS.USDC.address, type: "volume" },
        zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" }
      }
    });
    expect(result.dexFeeUsd).toBe(1);
    expect(result.unpriced).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" }
    ]);
  });
});

const params = {
  sellToken: TOKENS.USDC.address,
  buyToken: "0xtoken",
  sellAmount: "100000000"
};

describe("normalizeZeroxPriceQuote unpriced fees", () => {
  it("warns and carries unpricedFees when a fee cannot be valued", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" } }
    });
    expect(quote.dexFeeUsd).toBe(0);
    expect(quote.unpricedFees).toEqual([
      { type: "zeroExFee", token: "0xtoken", amount: "5000000000000000000" }
    ]);
    expect(quote.warnings).toContain(
      "0x reported a fee in 0xtoken the simulator could not value in USD; the real cost is higher than shown."
    );
  });

  it("stays clean for USDC-denominated fees", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: { zeroExFee: { amount: "1500000", token: TOKENS.USDC.address, type: "volume" } }
    });
    expect(quote.dexFeeUsd).toBe(1.5);
    expect(quote.unpricedFees).toEqual([]);
    expect(quote.warnings).toEqual([]);
  });

  it("lists multiple unpriced fee tokens in one warning", () => {
    const quote = normalizeZeroxPriceQuote(params, {
      buyAmount: "250000000",
      gas: "210000",
      gasPrice: "30000000000",
      fees: {
        zeroExFee: { amount: "5000000000000000000", token: "0xtoken", type: "volume" },
        integratorFee: { amount: "1000000000000000000", token: "0xweth", type: "volume" }
      }
    });
    expect(quote.warnings).toContain(
      "0x reported a fee in 0xtoken, 0xweth the simulator could not value in USD; the real cost is higher than shown."
    );
  });
});
