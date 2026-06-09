import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external", () => ({
  fetchWalletTransfers: vi.fn()
}));

const originalCwd = process.cwd();

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmgn-wallet-activity-route-"));
  process.chdir(tempDir);
  process.env.PAPER_TRADER_DB_PATH = path.join(tempDir, "data", "paper-trader.db");
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

describe("/api/wallets/[address]/activity", () => {
  it("returns cached stored activity without refetching chain data", async () => {
    const { insertWalletActivity, upsertTradeCandidates, upsertWallet } = await import("@/lib/repositories");
    const { fetchWalletTransfers } = await import("@/lib/external");
    const { GET } = await import("./route");
    const address = "0x8b391a554f3d2a4c34de70ebba1a345f68ee3f33";
    const hash = "0xcachedhash";

    upsertWallet({ address, label: "Five", notes: "", gmgnUrl: "" });
    insertWalletActivity([
      {
        walletAddress: address,
        chainId: 8453,
        chainName: "Base",
        hash,
        category: "external",
        asset: "ETH",
        contractAddress: "",
        value: 0.1,
        fromAddress: address,
        toAddress: "0xrouter",
        blockNum: "0x1",
        timestamp: "2026-06-09T20:30:55.000Z",
        isSwapLike: true,
        rawPayload: "{}"
      }
    ]);
    upsertTradeCandidates([
      {
        walletAddress: address,
        chainId: 8453,
        chainName: "Base",
        hash,
        status: "decoded",
        confidence: 0.9,
        side: "buy",
        tokenInAsset: "ETH",
        tokenInAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        tokenInAmount: 0.1,
        tokenOutAsset: "TKN",
        tokenOutAddress: "0x1234567890abcdef1234567890abcdef12345678",
        tokenOutAmount: 100,
        reason: "Paired wallet transfers indicate a likely buy using ETH for TKN.",
        transferCount: 2,
        sourceTimestamp: "2026-06-09T20:30:55.000Z"
      }
    ]);

    const response = await GET(new Request(`http://localhost/api/wallets/${address}/activity?cached=1`), {
      params: Promise.resolve({ address })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchWalletTransfers).not.toHaveBeenCalled();
    expect(body.source).toBe("cached");
    expect(body.activity).toHaveLength(1);
    expect(body.candidates).toHaveLength(1);
  });
});
