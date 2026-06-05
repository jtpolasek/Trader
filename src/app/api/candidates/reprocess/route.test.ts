import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmgn-reprocess-route-"));
  process.chdir(tempDir);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

describe("/api/candidates/reprocess", () => {
  it("previews missing stored-activity candidates without writing", async () => {
    const { insertWalletActivity, listTradeCandidates, upsertWallet } = await import("@/lib/repositories");
    const { GET } = await import("./route");
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "", gmgnUrl: "" });
    insertWalletActivity(nativeBuyActivity());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({ stored: 0, derived: 1, missing: 1, inserted: 0, newDecoded: 1 });
    expect(listTradeCandidates("0xwallet")).toHaveLength(0);
  });

  it("inserts missing stored-activity candidates on POST", async () => {
    const { insertWalletActivity, listTradeCandidates, upsertWallet } = await import("@/lib/repositories");
    const { POST } = await import("./route");
    upsertWallet({ address: "0xwallet", label: "Wallet", notes: "", gmgnUrl: "" });
    insertWalletActivity(nativeBuyActivity());

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({ stored: 0, derived: 1, missing: 1, inserted: 1, newDecoded: 1 });
    expect(listTradeCandidates("0xwallet")).toEqual([expect.objectContaining({ hash: "0xnativebuy" })]);
  });
});

function nativeBuyActivity() {
  return [
    {
      walletAddress: "0xwallet",
      chainId: 1,
      chainName: "Ethereum",
      hash: "0xnativebuy",
      category: "external",
      asset: "ETH",
      contractAddress: "",
      value: 0.01,
      fromAddress: "0xwallet",
      toAddress: "0xrouter",
      blockNum: "0x1",
      timestamp: "2026-06-04T00:00:00.000Z",
      isSwapLike: true,
      rawPayload: "{}"
    },
    {
      walletAddress: "0xwallet",
      chainId: 1,
      chainName: "Ethereum",
      hash: "0xnativebuy",
      category: "erc20",
      asset: "TKN",
      contractAddress: "0x0000000000000000000000000000000000000001",
      value: 10,
      fromAddress: "0xrouter",
      toAddress: "0xwallet",
      blockNum: "0x1",
      timestamp: "2026-06-04T00:00:00.000Z",
      isSwapLike: true,
      rawPayload: "{}"
    }
  ];
}
