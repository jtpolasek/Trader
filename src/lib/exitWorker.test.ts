import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkExitTrigger, calcExitQuantity } from "./exitWorker";

describe("checkExitTrigger", () => {
  it("returns tp when pnlPct meets takeProfitPct exactly", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 1.5,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBe("tp");
  });

  it("returns tp when pnlPct exceeds takeProfitPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 2.0,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBe("tp");
  });

  it("returns null when pnlPct is just below takeProfitPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 1.499,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: null
    })).toBeNull();
  });

  it("returns sl when pnlPct meets stopLossPct exactly", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 4.0,
      averageEntryUsd: 5.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBe("sl");
  });

  it("returns sl when pnlPct exceeds stopLossPct", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 0.5,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBe("sl");
  });

  it("returns null when pnlPct is just above stopLossPct threshold", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 0.801,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: 20
    })).toBeNull();
  });

  it("returns null when both thresholds are null", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 999,
      averageEntryUsd: 1.0,
      takeProfitPct: null,
      stopLossPct: null
    })).toBeNull();
  });

  it("prefers tp over sl when both fire simultaneously", () => {
    expect(checkExitTrigger({
      currentPriceUsd: 1.5,
      averageEntryUsd: 1.0,
      takeProfitPct: 50,
      stopLossPct: 20
    })).toBe("tp");
  });
});

describe("calcExitQuantity", () => {
  it("returns full quantity for 100%", () => {
    expect(calcExitQuantity(1000, 100)).toBe(1000);
  });

  it("returns half quantity for 50%", () => {
    expect(calcExitQuantity(1000, 50)).toBe(500);
  });

  it("handles fractional tokens", () => {
    expect(calcExitQuantity(333.333, 50)).toBeCloseTo(166.6665, 4);
  });
});

vi.mock("./zerox", () => ({
  getZeroxPrice: vi.fn()
}));
vi.mock("./external", () => ({
  buildQuotePreview: vi.fn()
}));

import { getDb } from "./db";
import { getExitFailures, updateExitRules, addExitFailure } from "./repositories";
import { runExitCheck, resetWorkerState } from "./exitWorker";
import { getZeroxPrice } from "./zerox";
import { buildQuotePreview } from "./external";

function seedPosition(tokenAddress: string, chainId: number, quantity: number, avgEntryUsd: number) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO tokens (address, chain_id, symbol, name, decimals, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tokenAddress, chainId, "TEST", "Test Token", 18, now);
  const tradeId = crypto.randomUUID();
  const notional = quantity * avgEntryUsd;
  db.prepare(
    `INSERT INTO trades (id, side, token_address, chain_id, quantity, price_usd, notional_usd,
      gas_usd, slippage_usd, dex_fee_usd, total_cost_usd, realized_pnl_usd, quote_snapshot, created_at)
     VALUES (?, 'buy', ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, '{}', ?)`
  ).run(tradeId, tokenAddress, chainId, quantity, avgEntryUsd, notional, notional, now);
  db.prepare(
    `INSERT INTO ledger_entries (id, entry_type, trade_id, token_address, chain_id,
      cash_delta, quantity_delta, cost_basis_delta, realized_pnl_delta, fee_delta, created_at)
     VALUES (?, 'buy', ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(crypto.randomUUID(), tradeId, tokenAddress, chainId, -notional, quantity, notional, now);
}

describe("runExitCheck", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM quotes").run();
    db.prepare("DELETE FROM tokens").run();
    db.prepare("DELETE FROM settings WHERE key IN ('exit_rules', 'exit_failures')").run();
    resetWorkerState();
    vi.clearAllMocks();
  });

  it("returns early when exit rules are disabled", async () => {
    updateExitRules({
      enabled: false,
      takeProfitPct: 50,
      stopLossPct: 20,
      exitSizePct: 100,
      checkIntervalSecs: 60
    });
    seedPosition("0xabc1230000000000000000000000000000000001", 8453, 100, 1.0);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("returns early when both thresholds are null", async () => {
    updateExitRules({
      enabled: true,
      takeProfitPct: null,
      stopLossPct: null,
      exitSizePct: 100,
      checkIntervalSecs: 60
    });
    seedPosition("0xabc1230000000000000000000000000000000002", 8453, 100, 1.0);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("skips a position already in exit_failures", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000003";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    addExitFailure({ tokenAddress, chainId: 8453, symbol: "TEST", reason: "prior failure", failedAt: new Date().toISOString() });
    seedPosition(tokenAddress, 8453, 100, 1.0);
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "15000000" } as never);
    await runExitCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("fires a sell and records the trade when TP threshold is crossed", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000004";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    seedPosition(tokenAddress, 8453, 100, 1.0);

    // price = 1.6 (up 60% > TP 50%): buyAmount = 10 / 1.6 * 1e18 ≈ 6.25e18
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "6250000000000000000" } as never);
    vi.mocked(buildQuotePreview).mockResolvedValue({
      side: "sell",
      quantity: 100,
      priceUsd: 1.6,
      notionalUsd: 160,
      gasUsd: 0.5,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 0.5,
      sellProceedsUsd: 159.5,
      warnings: [],
      quoteSnapshot: {}
    } as never);

    await runExitCheck();

    expect(buildQuotePreview).toHaveBeenCalledOnce();
    const db = getDb();
    const sellEntry = db.prepare(
      "SELECT * FROM ledger_entries WHERE entry_type = 'sell' LIMIT 1"
    ).get() as Record<string, unknown> | undefined;
    expect(sellEntry).toBeDefined();
    const trade = db.prepare(
      "SELECT quote_snapshot FROM trades WHERE side = 'sell' LIMIT 1"
    ).get() as { quote_snapshot: string } | undefined;
    const snap = JSON.parse(trade!.quote_snapshot) as Record<string, unknown>;
    expect(snap.autoExit).toBe(true);
    expect(snap.trigger).toBe("tp");
  });

  it("records an exit failure and does not trade when buildQuotePreview throws", async () => {
    const tokenAddress = "0xabc1230000000000000000000000000000000005";
    updateExitRules({ enabled: true, takeProfitPct: 50, stopLossPct: null, exitSizePct: 100, checkIntervalSecs: 60 });
    seedPosition(tokenAddress, 8453, 100, 1.0);
    vi.mocked(getZeroxPrice).mockResolvedValue({ buyAmount: "6250000000000000000" } as never);
    vi.mocked(buildQuotePreview).mockRejectedValue(new Error("No liquidity route found"));

    await runExitCheck();

    const failures = getExitFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].tokenAddress).toBe(tokenAddress);
    expect(failures[0].reason).toContain("No liquidity route found");
    const db = getDb();
    const sellCount = (db.prepare("SELECT COUNT(*) AS c FROM trades WHERE side = 'sell'").get() as { c: number }).c;
    expect(sellCount).toBe(0);
  });
});
