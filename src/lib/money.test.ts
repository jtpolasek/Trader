import { describe, expect, it } from "vitest";
import { formatUsdPrice, normalizeAddressInput } from "./money";

describe("formatUsdPrice", () => {
  it("keeps tiny token prices visible", () => {
    expect(formatUsdPrice(252.89 / 806_939_880.629991)).toBe("$3.134e-7");
  });

  it("formats small non-tiny prices with decimal precision", () => {
    expect(formatUsdPrice(0.012345)).toBe("$0.012345");
  });
});

describe("normalizeAddressInput", () => {
  it("accepts a plain address", () => {
    expect(normalizeAddressInput("0xC5A6bd7693E41b33f7f6FD6De3d82Bd8B124Ad8D")).toBe(
      "0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d"
    );
  });

  it("extracts an address from a GMGN wallet URL", () => {
    expect(normalizeAddressInput("https://gmgn.ai/base/address/0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d")).toBe(
      "0xc5a6bd7693e41b33f7f6fd6de3d82bd8b124ad8d"
    );
  });

  it("rejects values without an address", () => {
    expect(() => normalizeAddressInput("https://gmgn.ai/base/address/not-an-address")).toThrow(
      "Enter a valid Ethereum address or GMGN wallet URL."
    );
  });
});
