import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeInput } from "./types";

const originalCwd = process.cwd();

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmgn-ledger-"));
  process.chdir(tempDir);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

describe("recordTrade", () => {
  it("writes one ledger entry per trade and enforces uniqueness", async () => {
    const { getDb } = await import("./db");
    const { listLedgerEntries, recordTrade, upsertToken } = await import("./repositories");
    const db = getDb();
    const token = seedToken(upsertToken);

    const tradeId = recordTrade(tradeInput({ tokenAddress: token.address }));
    const entries = listLedgerEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tradeId, tokenAddress: token.address });
    expect(() =>
      db
        .prepare(
          `INSERT INTO ledger_entries
            (id, entry_type, trade_id, token_address, cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
           VALUES ('duplicate-ledger-entry', 'buy', ?, ?, 0, 0, 0, 0, 0, ?)`
        )
        .run(tradeId, token.address, new Date().toISOString())
    ).toThrow();
  });

  it("rolls back the trade row when the ledger entry write fails", async () => {
    const { getDb } = await import("./db");
    const { listLedgerEntries, listTrades, recordTrade, upsertToken } = await import("./repositories");
    const db = getDb();
    const token = seedToken(upsertToken);

    db.exec(`
      CREATE TRIGGER fail_ledger_insert
      BEFORE INSERT ON ledger_entries
      BEGIN
        SELECT RAISE(ABORT, 'ledger insert failed');
      END;
    `);

    expect(() => recordTrade(tradeInput({ tokenAddress: token.address }))).toThrow("ledger insert failed");
    expect(listTrades()).toHaveLength(0);
    expect(listLedgerEntries()).toHaveLength(0);
  });
});

describe("trade candidate copy results", () => {
  it("stores failed copy details without changing parser status", async () => {
    const {
      listTradeCandidates,
      updateTradeCandidateCopyResult,
      updateTradeCandidateStatus,
      upsertTradeCandidates,
      upsertWallet
    } = await import("./repositories");
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "", gmgnUrl: "" });
    upsertTradeCandidates([candidateInput({ status: "decoded", reason: "Paired wallet transfers indicate a likely swap." })]);

    let stored = listTradeCandidates("0xwallet")[0];
    updateTradeCandidateCopyResult({
      id: stored.id,
      status: "failed",
      bucket: "insufficient-cash",
      reason: "Insufficient paper cash for this copy after fees."
    });

    stored = listTradeCandidates("0xwallet")[0];
    expect(stored).toMatchObject({
      status: "decoded",
      reason: "Paired wallet transfers indicate a likely swap.",
      lastCopyStatus: "failed",
      lastCopyBucket: "insufficient-cash",
      lastCopyReason: "Insufficient paper cash for this copy after fees.",
      lastCopyTradeId: ""
    });

    updateTradeCandidateStatus(stored.id, "copied", "Copied into paper portfolio as trade trade-1.");
    updateTradeCandidateCopyResult({
      id: stored.id,
      status: "copied",
      reason: "Copied into paper portfolio as trade trade-1.",
      tradeId: "trade-1"
    });

    stored = listTradeCandidates("0xwallet")[0];
    expect(stored).toMatchObject({
      status: "copied",
      lastCopyStatus: "copied",
      lastCopyBucket: "",
      lastCopyReason: "Copied into paper portfolio as trade trade-1.",
      lastCopyTradeId: "trade-1"
    });
  });
});

function seedToken(upsertToken: (input: { address: string; symbol: string; name: string; decimals: number }) => unknown) {
  const token = {
    address: "0x0000000000000000000000000000000000000001",
    symbol: "TKN",
    name: "Token",
    decimals: 18
  };
  upsertToken(token);
  return token;
}

function tradeInput(overrides: Partial<TradeInput>): TradeInput {
  return {
    side: "buy",
    tokenAddress: "0x0000000000000000000000000000000000000001",
    quantity: 10,
    priceUsd: 10,
    notionalUsd: 100,
    gasUsd: 5,
    slippageUsd: 1,
    dexFeeUsd: 0,
    totalCostUsd: 106,
    realizedPnlUsd: 0,
    quoteSnapshot: "{}",
    ...overrides
  };
}

function candidateInput(overrides = {}) {
  return {
    walletAddress: "0xwallet",
    chainId: 1,
    chainName: "Ethereum",
    hash: "0xhash",
    status: "decoded" as const,
    confidence: 0.9,
    side: "buy" as const,
    tokenInAsset: "USDC",
    tokenInAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    tokenInAmount: 100,
    tokenOutAsset: "TKN",
    tokenOutAddress: "0x0000000000000000000000000000000000000001",
    tokenOutAmount: 10,
    reason: "Likely swap",
    transferCount: 2,
    sourceTimestamp: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}
