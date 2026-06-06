import { describe, expect, it } from "vitest";
import { TOKENS } from "./constants";
import { summarizeDexFees } from "./zerox";

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
});
