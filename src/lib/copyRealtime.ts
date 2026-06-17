import { BASE_CHAIN_ID, ETH_CHAIN_ID, getChainTokens } from "./constants";
import { runCopyCheck } from "./copyWorker";
import { getCopySettings, listWallets } from "./repositories";

type ChainId = typeof ETH_CHAIN_ID | typeof BASE_CHAIN_ID;

type SubscriptionMessage = {
  jsonrpc: "2.0";
  id: number;
  method: "eth_subscribe";
  params: [
    "alchemy_minedTransactions",
    {
      addresses: Array<{ from: string }>;
      includeRemoved: boolean;
      hashesOnly: boolean;
    }
  ];
};

const WATCHED_CHAINS = [ETH_CHAIN_ID, BASE_CHAIN_ID] as const;
const RESUBSCRIBE_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

let started = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const chainWatchers = new Map<number, ChainMinedTxWatcher>();

export function buildMinedTransactionsSubscription(id: number, walletAddresses: string[]): SubscriptionMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "eth_subscribe",
    params: [
      "alchemy_minedTransactions",
      {
        addresses: walletAddresses.map((address) => ({ from: address })),
        includeRemoved: false,
        hashesOnly: true
      }
    ]
  };
}

export function startCopyRealtimeWatcher(): void {
  if (started) return;
  started = true;

  if (typeof WebSocket === "undefined") {
    console.warn("[copy-realtime] WebSocket is unavailable; falling back to polling.");
    return;
  }

  refreshWatchers();
  refreshTimer = setInterval(refreshWatchers, RESUBSCRIBE_INTERVAL_MS);
}

export function stopCopyRealtimeWatcher(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  closeChainWatchers();
  started = false;
}

function refreshWatchers() {
  if (!getCopySettings().autoCopy) {
    closeChainWatchers();
    return;
  }

  const addresses = listWallets()
    .filter((wallet) => wallet.autoCopy)
    .map((wallet) => wallet.address.toLowerCase())
    .sort();

  for (const chainId of WATCHED_CHAINS) {
    const apiKey = getAlchemyApiKey(chainId);
    const existing = chainWatchers.get(chainId);
    if (!addresses.length || !apiKey) {
      existing?.close();
      chainWatchers.delete(chainId);
      continue;
    }

    const signature = addresses.join("|");
    if (existing?.signature === signature) continue;
    existing?.close();

    const watcher = new ChainMinedTxWatcher(chainId, apiKey, addresses, signature);
    chainWatchers.set(chainId, watcher);
    watcher.connect();
  }
}

function closeChainWatchers() {
  for (const watcher of chainWatchers.values()) {
    watcher.close();
  }
  chainWatchers.clear();
}

function getAlchemyApiKey(chainId: ChainId) {
  if (chainId === BASE_CHAIN_ID) return process.env.BASE_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY || "";
  return process.env.ALCHEMY_API_KEY || "";
}

class ChainMinedTxWatcher {
  readonly signature: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private closed = false;
  private subscriptionId = 1;

  constructor(
    private readonly chainId: ChainId,
    private readonly apiKey: string,
    private readonly addresses: string[],
    signature: string
  ) {
    this.signature = signature;
  }

  connect() {
    if (this.closed) return;
    const chainTokens = getChainTokens(this.chainId);
    const ws = new WebSocket(`wss://${chainTokens.alchemySubdomain}.g.alchemy.com/v2/${this.apiKey}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      ws.send(JSON.stringify(buildMinedTransactionsSubscription(this.subscriptionId++, this.addresses)));
    });

    ws.addEventListener("message", (event) => {
      if (isSubscriptionNotification(event.data)) {
        runCopyCheck({ force: true }).catch((err: unknown) => {
          console.error("[copy-realtime] Forced copy check failed:", err);
        });
      }
    });

    ws.addEventListener("error", () => {
      this.scheduleReconnect();
    });

    ws.addEventListener("close", () => {
      this.scheduleReconnect();
    });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    try {
      this.ws?.close();
    } catch {
      // Ignore close failures; reconnect timer owns recovery.
    }
    this.ws = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, this.reconnectDelayMs * 2);
  }
}

function isSubscriptionNotification(data: unknown) {
  if (typeof data !== "string") return false;
  try {
    const parsed = JSON.parse(data) as { method?: unknown; params?: unknown };
    return parsed.method === "eth_subscription" && Boolean(parsed.params);
  } catch {
    return false;
  }
}
