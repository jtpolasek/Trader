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

describe("candidate attention summary", () => {
  it("counts persisted candidate trust buckets across watched wallets", async () => {
    const {
      getCandidateAttentionSummary,
      listTradeCandidates,
      updateTradeCandidateCopyResult,
      updateTradeCandidateStatus,
      upsertTradeCandidates,
      upsertWallet
    } = await import("./repositories");
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "", gmgnUrl: "" });
    upsertWallet({ address: "0xwallet2", label: "Wallet 2", notes: "", gmgnUrl: "" });
    upsertTradeCandidates([
      candidateInput({ hash: "0xready", status: "decoded" }),
      candidateInput({
        hash: "0xreview",
        status: "candidate",
        confidence: 0.72,
        reason: "Multiple inbound or outbound transfers were found; selected the likely buy."
      }),
      candidateInput({
        hash: "0xblocked",
        status: "candidate",
        confidence: 0.52,
        reason: "Multiple possible received tokens were found; selected the likely buy."
      }),
      candidateInput({ hash: "0xmissing", status: "candidate", tokenOutAddress: "" }),
      candidateInput({ walletAddress: "0xwallet2", hash: "0xfailed", status: "decoded" }),
      candidateInput({ walletAddress: "0xwallet2", hash: "0xcopied", status: "decoded" })
    ]);

    const failed = getCandidateByHash(listTradeCandidates("0xwallet2"), "0xfailed");
    updateTradeCandidateCopyResult({
      id: failed.id,
      status: "failed",
      bucket: "no-liquidity",
      reason: "No usable 0x liquidity or route was found."
    });
    const copied = getCandidateByHash(listTradeCandidates("0xwallet2"), "0xcopied");
    updateTradeCandidateStatus(copied.id, "copied", "Copied into paper portfolio.");
    updateTradeCandidateCopyResult({
      id: copied.id,
      status: "copied",
      reason: "Copied into paper portfolio.",
      tradeId: "trade-1"
    });

    expect(getCandidateAttentionSummary()).toEqual({
      ready: 1,
      review: 1,
      blocked: 2,
      failed: 1,
      copied: 1,
      total: 6
    });
  });
});

describe("exportLocalData", () => {
  it("exports full local simulator state for backup or handoff", async () => {
    const {
      exportLocalData,
      insertQuote,
      insertWalletActivity,
      recordTrade,
      updateCopySettings,
      upsertToken,
      upsertTradeCandidates,
      upsertWallet
    } = await import("./repositories");
    const token = seedToken(upsertToken);

    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "watch", gmgnUrl: "https://gmgn.ai/0xwallet" });
    updateCopySettings({
      mode: "fixedUsd",
      fixedUsd: 150,
      percentOfSource: 20,
      maxTradeUsd: 600,
      slippageCapBps: 90,
      gasBufferBps: 1200,
      insufficientCashBehavior: "cap",
      allowlist: [token.address],
      blocklist: []
    });
    insertWalletActivity([
      {
        walletAddress: "0xwallet",
        chainId: 8453,
        chainName: "Base",
        hash: "0xactivity",
        category: "erc20",
        asset: "TKN",
        contractAddress: token.address,
        value: 10,
        fromAddress: "0xrouter",
        toAddress: "0xwallet",
        blockNum: "0x1",
        timestamp: "2026-06-04T00:00:00.000Z",
        isSwapLike: true,
        rawPayload: JSON.stringify({ rawContract: { decimal: "0x12" } })
      }
    ]);
    upsertTradeCandidates([candidateInput({ hash: "0xcandidate", chainId: 8453, chainName: "Base" })]);
    insertQuote({
      tokenAddress: token.address,
      side: "buy",
      quantity: 10,
      priceUsd: 10,
      notionalUsd: 100,
      gasUsd: 5,
      slippageUsd: 1,
      dexFeeUsd: 0,
      quoteSnapshot: JSON.stringify({ provider: "0x" })
    });
    recordTrade(tradeInput({ tokenAddress: token.address }));

    const backup = exportLocalData();

    expect(backup.schemaVersion).toBe(1);
    expect(new Date(backup.exportedAt).toString()).not.toBe("Invalid Date");
    expect(backup.app).toEqual({ name: "gmgn-paper-trader", version: "0.1.0" });
    expect(backup.wallets).toHaveLength(1);
    expect(backup.copySettings).toMatchObject({ fixedUsd: 150, insufficientCashBehavior: "cap" });
    expect(backup.tokens).toEqual([expect.objectContaining({ address: token.address, symbol: "TKN" })]);
    expect(backup.trades).toHaveLength(1);
    expect(backup.ledgerEntries).toHaveLength(1);
    expect(backup.quotes).toEqual([expect.objectContaining({ tokenAddress: token.address, quoteSnapshot: "{\"provider\":\"0x\"}" })]);
    expect(backup.walletActivity).toEqual([
      expect.objectContaining({ chainId: 8453, rawPayload: "{\"rawContract\":{\"decimal\":\"0x12\"}}" })
    ]);
    expect(backup.tradeCandidates).toEqual([expect.objectContaining({ hash: "0xcandidate", chainName: "Base" })]);
    expect(backup.candidateAttention).toMatchObject({ ready: 1, total: 1 });
    expect(backup.portfolio.cashUsd).toBeLessThan(backup.portfolio.startingCashUsd);
    expect(backup.positions).toEqual([expect.objectContaining({ tokenAddress: token.address, quantity: 10 })]);
    expect(backup.settings).toEqual([expect.objectContaining({ key: "copy_settings" })]);
  });
});

describe("resetPaperPortfolio", () => {
  it("clears simulated portfolio state while preserving watch data and settings", async () => {
    const {
      getCandidateAttentionSummary,
      getCopySettings,
      getPortfolio,
      insertQuote,
      insertWalletActivity,
      listLedgerEntries,
      listPositions,
      listTradeCandidates,
      listTrades,
      listWalletActivity,
      listWallets,
      recordTrade,
      resetPaperPortfolio,
      updateCopySettings,
      updateTradeCandidateCopyResult,
      updateTradeCandidateStatus,
      upsertToken,
      upsertTradeCandidates,
      upsertWallet
    } = await import("./repositories");
    const token = seedToken(upsertToken);
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "keep", gmgnUrl: "" });
    updateCopySettings({
      mode: "fixedUsd",
      fixedUsd: 125,
      percentOfSource: 25,
      maxTradeUsd: 500,
      slippageCapBps: 100,
      gasBufferBps: 1500,
      insufficientCashBehavior: "cap",
      allowlist: [token.address],
      blocklist: []
    });
    insertWalletActivity([
      {
        walletAddress: "0xwallet",
        chainId: 1,
        chainName: "Ethereum",
        hash: "0xactivity",
        category: "erc20",
        asset: "TKN",
        contractAddress: token.address,
        value: 10,
        fromAddress: "0xrouter",
        toAddress: "0xwallet",
        blockNum: "0x1",
        timestamp: "2026-06-04T00:00:00.000Z",
        isSwapLike: true,
        rawPayload: "{}"
      }
    ]);
    upsertTradeCandidates([candidateInput({ hash: "0xcandidate", tokenOutAddress: token.address })]);
    const stored = listTradeCandidates("0xwallet")[0];
    updateTradeCandidateStatus(stored.id, "copied", "Copied into paper portfolio as trade trade-1.");
    updateTradeCandidateCopyResult({
      id: stored.id,
      status: "copied",
      reason: "Copied into paper portfolio as trade trade-1.",
      tradeId: "trade-1"
    });
    insertQuote({
      tokenAddress: token.address,
      side: "buy",
      quantity: 10,
      priceUsd: 10,
      notionalUsd: 100,
      gasUsd: 5,
      slippageUsd: 1,
      dexFeeUsd: 0,
      quoteSnapshot: "{}"
    });
    recordTrade(tradeInput({ tokenAddress: token.address }));

    expect(listTrades()).toHaveLength(1);
    expect(listLedgerEntries()).toHaveLength(1);
    expect(getPortfolio().cashUsd).toBeLessThan(getPortfolio().startingCashUsd);

    const resetPortfolio = resetPaperPortfolio();

    expect(resetPortfolio).toMatchObject({
      cashUsd: resetPortfolio.startingCashUsd,
      realizedPnlUsd: 0,
      feesPaidUsd: 0
    });
    expect(listTrades()).toHaveLength(0);
    expect(listLedgerEntries()).toHaveLength(0);
    expect(listPositions()).toHaveLength(0);
    expect(listWallets()).toHaveLength(1);
    expect(listWalletActivity("0xwallet")).toHaveLength(1);
    expect(getCopySettings()).toMatchObject({ fixedUsd: 125, insufficientCashBehavior: "cap" });
    expect(listTradeCandidates("0xwallet")[0]).toMatchObject({
      status: "candidate",
      lastCopyStatus: "",
      lastCopyReason: "",
      lastCopyTradeId: "",
      reason: "Paper portfolio was reset; review this candidate before copying again."
    });
    expect(getCandidateAttentionSummary()).toMatchObject({ copied: 0 });
  });
});

describe("wallet activity token hints", () => {
  it("extracts token symbol and decimals from stored raw transfer payloads", async () => {
    const { getWalletActivityTokenHint, insertWalletActivity, upsertWallet } = await import("./repositories");
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "", gmgnUrl: "" });
    insertWalletActivity([
      {
        walletAddress: "0xwallet",
        chainId: 8453,
        chainName: "Base",
        hash: "0xhash",
        category: "erc20",
        asset: "TKN",
        contractAddress: "0x0000000000000000000000000000000000000001",
        value: 100,
        fromAddress: "0xrouter",
        toAddress: "0xwallet",
        blockNum: "0x1",
        timestamp: "2026-06-04T00:00:00.000Z",
        isSwapLike: true,
        rawPayload: JSON.stringify({ rawContract: { decimal: "0x12" } })
      }
    ]);

    expect(
      getWalletActivityTokenHint({
        walletAddress: "0xwallet",
        chainId: 8453,
        hash: "0xhash",
        tokenAddress: "0x0000000000000000000000000000000000000001"
      })
    ).toEqual({ symbol: "TKN", name: "TKN", decimals: 18 });
  });
});

describe("vestigial state migration", () => {
  it("drops the positions table and legacy portfolio total columns on existing databases", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dataDir = path.join(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });

    const legacy = new DatabaseSync(path.join(dataDir, "paper-trader.db"));
    legacy.exec(`
      CREATE TABLE portfolios (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cash_usd REAL NOT NULL,
        starting_cash_usd REAL NOT NULL,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        fees_paid_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE positions (
        token_address TEXT PRIMARY KEY,
        quantity REAL NOT NULL,
        average_entry_usd REAL NOT NULL,
        cost_basis_usd REAL NOT NULL,
        realized_pnl_usd REAL NOT NULL DEFAULT 0,
        fees_paid_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO portfolios
        (id, name, cash_usd, starting_cash_usd, realized_pnl_usd, fees_paid_usd, created_at, updated_at)
      VALUES
        ('default', 'Main Paper Account', 4200, 10000, -1, 7,
         '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    `);
    legacy.close();

    vi.resetModules();
    const { getDb } = await import("./db");
    const { getPortfolio } = await import("./repositories");
    const db = getDb();

    const portfolioColumns = (
      db.prepare("PRAGMA table_info(portfolios)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(portfolioColumns).not.toContain("cash_usd");
    expect(portfolioColumns).not.toContain("realized_pnl_usd");
    expect(portfolioColumns).not.toContain("fees_paid_usd");
    expect(portfolioColumns).toContain("starting_cash_usd");

    const positionsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'positions'")
      .get();
    expect(positionsTable).toBeUndefined();

    const portfolio = getPortfolio();
    expect(portfolio.startingCashUsd).toBe(10000);
    expect(portfolio.cashUsd).toBe(10000);
    expect(portfolio.realizedPnlUsd).toBe(0);
    expect(portfolio.feesPaidUsd).toBe(0);
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

function getCandidateByHash(candidates: Array<{ id: string; hash: string }>, hash: string) {
  const candidate = candidates.find((item) => item.hash === hash);
  if (!candidate) throw new Error(`Missing candidate ${hash}`);
  return candidate;
}
