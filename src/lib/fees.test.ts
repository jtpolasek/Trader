import { describe, expect, it } from "vitest";
import { valueUnpricedFees, type FeePriceAnchor } from "./fees";

const TOKEN = "0xbuytoken0000000000000000000000000000beef";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const anchors: FeePriceAnchor[] = [
  { address: WETH, usdPrice: 3000, decimals: 18 },
  { address: USDC, usdPrice: 1, decimals: 6 },
  { address: TOKEN, usdPrice: 0.4, decimals: 18 }
];

describe("valueUnpricedFees", () => {
  it("values a fee in the traded token against its anchor", () => {
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2, 10);
    expect(result.pricedTokens).toEqual([TOKEN]);
    expect(result.stillUnpriced).toEqual([]);
  });

  it("values a fee in WETH using the native price anchor", () => {
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: WETH.toUpperCase(), amount: "1000000000000000000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(3000, 10);
    expect(result.stillUnpriced).toEqual([]);
  });

  it("values a fee in USDC at price 1", () => {
    const result = valueUnpricedFees(
      [{ type: "integratorFee", token: USDC, amount: "2500000" }],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2.5, 10);
  });

  it("leaves a fee with no matching anchor unpriced", () => {
    const fee = { type: "zeroExFee", token: "0xunknown", amount: "1000000000000000000" };
    const result = valueUnpricedFees([fee], anchors);
    expect(result.valuedUsd).toBe(0);
    expect(result.pricedTokens).toEqual([]);
    expect(result.stillUnpriced).toEqual([fee]);
  });

  it("splits a mix of priced and unpriced fees", () => {
    const unknown = { type: "integratorFee", token: "0xunknown", amount: "1000000000000000000" };
    const result = valueUnpricedFees(
      [{ type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" }, unknown],
      anchors
    );
    expect(result.valuedUsd).toBeCloseTo(2, 10);
    expect(result.pricedTokens).toEqual([TOKEN]);
    expect(result.stillUnpriced).toEqual([unknown]);
  });

  it("does not credit a fee whose anchor price is not a positive number", () => {
    const fee = { type: "zeroExFee", token: TOKEN, amount: "5000000000000000000" };
    const result = valueUnpricedFees([fee], [
      { address: TOKEN, usdPrice: 0, decimals: 18 }
    ]);
    expect(result.valuedUsd).toBe(0);
    expect(result.stillUnpriced).toEqual([fee]);
  });

  it("returns a zeroed result for empty input", () => {
    expect(valueUnpricedFees([], anchors)).toEqual({
      valuedUsd: 0,
      pricedTokens: [],
      stillUnpriced: []
    });
  });
});
