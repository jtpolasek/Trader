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
