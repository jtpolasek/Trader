import { describe, expect, it } from "vitest";
import { isQuoteStale } from "./quoteAge";

describe("isQuoteStale", () => {
  it("returns false when age is under threshold", () => {
    expect(isQuoteStale(1000, 120999, 120000)).toBe(false);
  });

  it("returns false when age equals threshold exactly", () => {
    expect(isQuoteStale(1000, 121000, 120000)).toBe(false);
  });

  it("returns true when age exceeds threshold", () => {
    expect(isQuoteStale(1000, 121001, 120000)).toBe(true);
  });
});
