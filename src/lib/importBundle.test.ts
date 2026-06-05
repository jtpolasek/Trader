import { describe, expect, it } from "vitest";
import { parseImportBundle, summarizeImportBundle } from "./importBundle";

function validBundle() {
  return {
    schemaVersion: 1,
    exportedAt: "2026-06-05T00:00:00.000Z",
    app: { name: "gmgn-paper-trader", version: "0.1.0" },
    portfolio: {
      id: "default",
      name: "Main Paper Account",
      cashUsd: 9000,
      startingCashUsd: 10000,
      realizedPnlUsd: 0,
      feesPaidUsd: 5,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    },
    copySettings: { mode: "fixedUsd" },
    candidateAttention: { ready: 0, review: 0, blocked: 0, failed: 0, copied: 0, total: 0 },
    wallets: [
      { address: "0xwallet", label: "W", notes: "", gmgnUrl: "", createdAt: "2026-06-01T00:00:00.000Z" }
    ],
    tokens: [
      { address: "0xtoken", symbol: "TKN", name: "Token", decimals: 18, createdAt: "2026-06-01T00:00:00.000Z" }
    ],
    positions: [],
    trades: [
      {
        id: "trade-1", side: "buy", tokenAddress: "0xtoken", symbol: "TKN", quantity: 10, priceUsd: 10,
        notionalUsd: 100, gasUsd: 5, slippageUsd: 1, dexFeeUsd: 0, totalCostUsd: 106, realizedPnlUsd: 0,
        quoteSnapshot: "{}", createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    ledgerEntries: [
      {
        id: "ledger-1", tradeId: "trade-1", tokenAddress: "0xtoken", entryType: "buy", cashDelta: -106,
        quantityDelta: 10, costBasisDelta: 100, realizedPnlDelta: 0, feeDelta: 6, createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    quotes: [
      {
        id: "quote-1", tokenAddress: "0xtoken", side: "buy", quantity: 10, priceUsd: 10, notionalUsd: 100,
        gasUsd: 5, slippageUsd: 1, dexFeeUsd: 0, quoteSnapshot: "{}", createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    walletActivity: [
      {
        id: "act-1", walletAddress: "0xwallet", chainId: 1, chainName: "Ethereum", hash: "0xhash",
        category: "erc20", asset: "TKN", contractAddress: "0xtoken", value: 10, fromAddress: "0xrouter",
        toAddress: "0xwallet", blockNum: "0x1", timestamp: "2026-06-02T00:00:00.000Z", isSwapLike: true, rawPayload: "{}"
      }
    ],
    tradeCandidates: [
      {
        id: "cand-1", walletAddress: "0xwallet", chainId: 1, chainName: "Ethereum", hash: "0xhash",
        status: "candidate", confidence: 0.5, side: "buy", tokenInAsset: "USDC", tokenInAddress: "0xusdc",
        tokenInAmount: 100, tokenOutAsset: "TKN", tokenOutAddress: "0xtoken", tokenOutAmount: 10,
        reason: "Likely swap", transferCount: 2, sourceTimestamp: "2026-06-02T00:00:00.000Z",
        lastCopyStatus: "", lastCopyBucket: "", lastCopyReason: "", lastCopyTradeId: "", lastCopyAt: "",
        createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    settings: [{ key: "copy_settings", value: "{\"mode\":\"fixedUsd\"}" }]
  };
}

describe("parseImportBundle", () => {
  it("accepts a valid version 1 export and keeps authoritative collections", () => {
    const bundle = parseImportBundle(validBundle());
    expect(bundle.wallets).toHaveLength(1);
    expect(bundle.trades[0].id).toBe("trade-1");
    expect(bundle.ledgerEntries[0].entryType).toBe("buy");
    expect(bundle.portfolio).toEqual({ name: "Main Paper Account", startingCashUsd: 10000 });
  });

  it("rejects an unsupported schema version", () => {
    const input = { ...validBundle(), schemaVersion: 2 };
    expect(() => parseImportBundle(input)).toThrow("Unsupported export schemaVersion 2");
  });

  it("rejects a non-object input", () => {
    expect(() => parseImportBundle("nope")).toThrow("expected a JSON object");
  });

  it("rejects a bundle missing a required collection", () => {
    const input = validBundle() as Record<string, unknown>;
    delete input.trades;
    expect(() => parseImportBundle(input)).toThrow("not a valid version 1 export");
  });

  it("rejects a malformed row", () => {
    const input = validBundle();
    (input.trades[0] as Record<string, unknown>).quantity = "ten";
    expect(() => parseImportBundle(input)).toThrow("not a valid version 1 export");
  });
});

describe("summarizeImportBundle", () => {
  it("counts collections and reads starting cash", () => {
    const summary = summarizeImportBundle(parseImportBundle(validBundle()));
    expect(summary).toEqual({
      wallets: 1, tokens: 1, trades: 1, ledgerEntries: 1, quotes: 1,
      walletActivity: 1, tradeCandidates: 1, settings: 1, startingCashUsd: 10000
    });
  });
});
