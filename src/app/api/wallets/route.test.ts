import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmgn-wallet-route-"));
  process.chdir(tempDir);
  process.env.PAPER_TRADER_DB_PATH = path.join(tempDir, "data", "paper-trader.db");
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

describe("/api/wallets", () => {
  it("leaves global auto-copy untouched when auto-copy is enabled for a wallet", async () => {
    const { getCopySettings, updateCopySettings, upsertWallet } = await import("@/lib/repositories");
    const { PATCH } = await import("./route");
    const address = "0x1234560000000000000000000000000000000001";
    upsertWallet({ address, label: "Test wallet", notes: "", gmgnUrl: "" });
    updateCopySettings({ ...getCopySettings(), autoCopy: false });

    const response = await PATCH(
      new Request("http://localhost/api/wallets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, autoCopy: true })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ address, autoCopy: true });
    expect(getCopySettings().autoCopy).toBe(false);
  });
});
