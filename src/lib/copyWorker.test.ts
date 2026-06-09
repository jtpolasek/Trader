import { describe, it, expect, beforeEach, vi } from "vitest";
import { shouldAutoCopy } from "./copyWorker";
import type { TradeCandidate } from "./types";

function makeCandidate(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: "test-id",
    walletAddress: "0xwallet000000000000000000000000000000001",
    chainId: 8453,
    chainName: "Base",
    hash: "0xhash",
    status: "decoded",
    confidence: 0.95,
    side: "buy",
    tokenInAsset: "USDC",
    tokenInAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenInAmount: 100,
    tokenOutAsset: "TOKEN",
    tokenOutAddress: "0xtoken000000000000000000000000000000001",
    tokenOutAmount: 1000,
    reason: "decoded: clear buy shape",
    transferCount: 2,
    sourceTimestamp: new Date().toISOString(),
    lastCopyStatus: "",
    lastCopyBucket: "",
    lastCopyReason: "",
    lastCopyTradeId: "",
    lastCopyAt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("shouldAutoCopy", () => {
  it("returns true for a decoded buy with no prior copy attempt", () => {
    expect(shouldAutoCopy(makeCandidate())).toBe(true);
  });

  it("returns false when status is not decoded", () => {
    expect(shouldAutoCopy(makeCandidate({ status: "candidate" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ status: "partial" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ status: "failed" }))).toBe(false);
  });

  it("returns false when side is not buy", () => {
    expect(shouldAutoCopy(makeCandidate({ side: "sell" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ side: "unknown" }))).toBe(false);
  });

  it("returns false when lastCopyStatus is set (already attempted)", () => {
    expect(shouldAutoCopy(makeCandidate({ lastCopyStatus: "copied" }))).toBe(false);
    expect(shouldAutoCopy(makeCandidate({ lastCopyStatus: "failed" }))).toBe(false);
  });
});

vi.mock("./external", () => ({
  fetchWalletTransfers: vi.fn(),
  buildQuotePreview: vi.fn(),
  getNativeUsdPrice: vi.fn(),
  resolveTokenFromAlchemy: vi.fn()
}));

import { getDb } from "./db";
import {
  getCopySettings,
  listTradeCandidates,
  updateCopySettings,
  upsertTradeCandidates,
  upsertWallet
} from "./repositories";
import { runCopyCheck, resetCopyWorkerState } from "./copyWorker";
import {
  fetchWalletTransfers,
  buildQuotePreview,
  getNativeUsdPrice,
  resolveTokenFromAlchemy
} from "./external";

const TEST_WALLET = "0x1234560000000000000000000000000000000001";
const TEST_TOKEN = "0x1234560000000000000000000000000000000002";

function seedWallet() {
  upsertWallet({ address: TEST_WALLET, label: "Test", notes: "", gmgnUrl: "" });
}

function seedDecodedBuyCandidate(hashSuffix: string, tokenAddress = TEST_TOKEN): string {
  const hash = `0xdeadbeef${hashSuffix}`;
  upsertTradeCandidates([{
    walletAddress: TEST_WALLET,
    chainId: 8453,
    chainName: "Base",
    hash,
    status: "decoded",
    confidence: 0.95,
    side: "buy",
    tokenInAsset: "USDC",
    tokenInAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenInAmount: 100,
    tokenOutAsset: "TOKEN",
    tokenOutAddress: tokenAddress,
    tokenOutAmount: 1000,
    reason: "decoded: clear buy shape",
    transferCount: 2,
    sourceTimestamp: new Date().toISOString()
  }]);
  return listTradeCandidates(TEST_WALLET).find((c) => c.hash === hash)!.id;
}

describe("runCopyCheck", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM trades").run();
    db.prepare("DELETE FROM tokens").run();
    db.prepare("DELETE FROM trade_candidates").run();
    db.prepare("DELETE FROM wallet_activity").run();
    db.prepare("DELETE FROM wallets").run();
    db.prepare("DELETE FROM settings WHERE key = 'copy_settings'").run();
    resetCopyWorkerState();
    vi.clearAllMocks();
    vi.mocked(fetchWalletTransfers).mockResolvedValue({ transfers: [], warnings: [] });
    vi.mocked(getNativeUsdPrice).mockResolvedValue(2500);
  });

  it("returns early when autoCopy is disabled", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: false });
    seedWallet();
    seedDecodedBuyCandidate("01");
    await runCopyCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("skips a candidate whose lastCopyStatus is already set", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true });
    seedWallet();
    const id = seedDecodedBuyCandidate("02");
    getDb()
      .prepare("UPDATE trade_candidates SET last_copy_status = 'copied' WHERE id = ?")
      .run(id);
    await runCopyCheck();
    expect(buildQuotePreview).not.toHaveBeenCalled();
  });

  it("executes a buy trade and stamps autoCopied in quoteSnapshot", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true, fixedUsd: 100 });
    seedWallet();
    seedDecodedBuyCandidate("03");
    vi.mocked(resolveTokenFromAlchemy).mockResolvedValue({
      address: TEST_TOKEN,
      chainId: 8453,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      createdAt: new Date().toISOString()
    });
    vi.mocked(buildQuotePreview).mockResolvedValue({
      side: "buy",
      token: { address: TEST_TOKEN, chainId: 8453, symbol: "TKN", name: "Token", decimals: 18, createdAt: "" },
      quantity: 500,
      priceUsd: 0.2,
      notionalUsd: 100,
      gasUsd: 0.5,
      slippageUsd: 0,
      dexFeeUsd: 0,
      totalCostUsd: 100.5,
      sellProceedsUsd: 0,
      warnings: [],
      quoteSnapshot: {}
    } as never);

    await runCopyCheck();

    expect(buildQuotePreview).toHaveBeenCalledOnce();
    const db = getDb();
    const trade = db
      .prepare("SELECT * FROM trades WHERE side = 'buy' LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    expect(trade).toBeDefined();
    const snap = JSON.parse(String(trade!.quote_snapshot)) as Record<string, unknown>;
    expect(snap.autoCopied).toBe(true);
    expect((snap.copiedFrom as Record<string, unknown>).walletAddress).toBe(TEST_WALLET);
  });

  it("records lastCopyStatus = failed when buildQuotePreview throws", async () => {
    updateCopySettings({ ...getCopySettings(), autoCopy: true });
    seedWallet();
    const id = seedDecodedBuyCandidate("04");
    vi.mocked(resolveTokenFromAlchemy).mockResolvedValue({
      address: TEST_TOKEN, chainId: 8453, symbol: "TKN", name: "Token", decimals: 18,
      createdAt: new Date().toISOString()
    });
    vi.mocked(buildQuotePreview).mockRejectedValue(new Error("No liquidity route found"));

    await runCopyCheck();

    const candidate = listTradeCandidates(TEST_WALLET).find((c) => c.id === id)!;
    expect(candidate.lastCopyStatus).toBe("failed");
    const count = (
      getDb().prepare("SELECT COUNT(*) AS c FROM trades WHERE side = 'buy'").get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });
});
