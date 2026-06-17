import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMinedTransactionsSubscription,
  startCopyRealtimeWatcher,
  stopCopyRealtimeWatcher
} from "./copyRealtime";
import { getDb } from "./db";
import { getCopySettings, updateCopySettings, upsertWallet } from "./repositories";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  close = vi.fn();
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener() {
    // Tests assert connection lifecycle only.
  }
}

function seedAutoCopyWallet() {
  upsertWallet({
    address: "0x1111111111111111111111111111111111111111",
    label: "Watched",
    notes: "",
    gmgnUrl: "",
    autoCopy: true
  });
}

describe("buildMinedTransactionsSubscription", () => {
  it("subscribes to mined outgoing transactions for watched wallets", () => {
    expect(
      buildMinedTransactionsSubscription(7, [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222"
      ])
    ).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "eth_subscribe",
      params: [
        "alchemy_minedTransactions",
        {
          addresses: [
            { from: "0x1111111111111111111111111111111111111111" },
            { from: "0x2222222222222222222222222222222222222222" }
          ],
          includeRemoved: false,
          hashesOnly: true
        }
      ]
    });
  });
});

describe("startCopyRealtimeWatcher", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM wallets").run();
    db.prepare("DELETE FROM settings WHERE key = 'copy_settings'").run();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    process.env.ALCHEMY_API_KEY = "test-key";
    delete process.env.BASE_ALCHEMY_API_KEY;
  });

  afterEach(() => {
    stopCopyRealtimeWatcher();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.BASE_ALCHEMY_API_KEY;
  });

  it("does not open realtime sockets when global auto-copy is disabled", () => {
    seedAutoCopyWallet();
    updateCopySettings({ ...getCopySettings(), autoCopy: false });

    startCopyRealtimeWatcher();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("closes open realtime sockets when global auto-copy is disabled later", () => {
    vi.useFakeTimers();
    seedAutoCopyWallet();
    updateCopySettings({ ...getCopySettings(), autoCopy: true });

    startCopyRealtimeWatcher();
    expect(FakeWebSocket.instances).toHaveLength(2);

    updateCopySettings({ ...getCopySettings(), autoCopy: false });
    vi.advanceTimersByTime(30_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.every((socket) => socket.close.mock.calls.length === 1)).toBe(true);
  });
});
